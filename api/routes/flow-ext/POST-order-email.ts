import { RouteHandler } from "gadget-server";
import { generateOrderEmailTemplate, formatDate, formatCurrency } from "../../templates/orderEmail";
import { TransactionalEmailsApi, TransactionalEmailsApiApiKeys } from "@getbrevo/brevo";

// Custom error classes for better error handling
class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}
class AuthenticationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuthenticationError';
  }
}
class ShopifyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ShopifyError';
  }
}
class MailerError extends Error {
  statusCode?: number;
  details?: any;
  constructor(message: string, statusCode?: number, details?: any) {
    super(message);
    this.name = 'MailerError';
    this.statusCode = statusCode;
    this.details = details;
  }
}
class ConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigurationError';
  }
}
class DuplicationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DuplicationError';
  }
}

interface ShopifyOrder {
  id: string;
  name: string;
  email: string;
  processedAt: string;
  createdAt: string;
  customerId?: string;
  legacyResourceId?: string;
  shopId: string;
  lineItems: {
    id: string;
    title: string;
    quantity: number;
    image?: string;
  }[];
}
function extractNumericId(gidOrId: string): string {
  // If it's already just a number, return as-is
  if (/^\d+$/.test(gidOrId)) {
    return gidOrId;
  }
  
  // If it's a GID, extract the numeric part
  const match = gidOrId.match(/gid:\/\/shopify\/\w+\/(\d+)/);
  if (match) {
    return match[1];
  }
  
  // If neither format matches, throw an error
  throw new ValidationError(`Invalid order ID format: ${gidOrId}`);
}
async function validateInputs(body: any, connections: any) {
  if (!body.properties || !body.properties.id) {
    throw new ValidationError("Missing orderId in request body");
  }
  if (!body.properties.lineItems) {
    throw new ValidationError("Missing lineItems Data in request body");
  }
  // Validate shop authentication
  const shopId = body.shop_id || connections.shopify?.current?.shopId;
  if (!shopId) {
    throw new AuthenticationError("No active shop session found");
  }
  return {
    orderId :body.properties.id,
    shopId,
    items: JSON.parse(body.properties.lineItems)
  };
}
async function getOrder(shopId: string, orderId: string, api:any, logger: any) {
    const legacyIdNum = extractNumericId(orderId);
    let order: ShopifyOrder | null = await api.shopifyOrder.findOne(legacyIdNum, {
        select: {
          id: true,
          name: true, 
          email: true,
          processedAt: true,
          createdAt: true,
          customerId: true,
          legacyResourceId: true,
          shopId: true
        }
      });
      logger.debug({ order }, "Fetched order data from Shopify API");
    if (!order) {
      throw new ShopifyError(`Order with ID ${orderId} not found`);
    }

    // Validate order belongs to current shop
    if (String(order.shopId) !== String(shopId)) {
      logger.error({ 
        orderId, 
        orderShopId: order.shopId, 
        currentShopId: shopId 
      }, "Order tenant mismatch");
      throw new AuthenticationError("Order does not belong to the authenticated shop");
    }
    return {
      orderNumber: order.name || "Unknown Order",
      order,
      orderDate: formatDate(order.processedAt || order.createdAt)
    };
}
async function checkEmailDeduplication(api: any, orderId: string, shopId: string, logger: any) {
  try {
    const existing = await api.emailLog.findFirst({
      filter: {
        orderId: { equals: orderId },
        emailType: { equals: "order_confirmation" },
        shop: { equals: shopId }
      }
    });
    
    if (existing) {
      logger.info({ orderId, existingEmailId: existing.id }, "Email already sent for this order");
      throw new DuplicationError(`Order confirmation email already sent for order ${orderId}`);
    }
    
    logger.debug({ orderId }, "No duplicate email found, proceeding with send");
  } catch (error: any) {
    if (error instanceof DuplicationError) {
      throw error;
    }
    logger.error({ error: error.message, orderId }, "Error checking email deduplication");
    throw new Error(`Failed to check email deduplication: ${error.message}`);
  }
}
async function getCustomerData(api: any, order: any, logger: any) {
  let customer: any = null;
    if (order.customerId) {
      try {
       customer = await api.shopifyCustomer.findOne(order.customerId, {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true
          }
        });
        logger.info({ customerId: order.customerId }, "Customer data fetched successfully");
      } catch (error) {
        logger.warn({ customerId: order.customerId, error: error instanceof Error ? error.message : 'Unknown error' }, 
          "Error fetching customer data, will proceed with order email");
        // We'll continue without customer data since the order might still have an email
      }
    } else {
      logger.info("No customer ID associated with this order");
    }

    // Validate customer email
    const customerEmail = order.email || (customer && customer.email);
    if (!customerEmail) {
      throw new ValidationError(`No email address found for order ${order.name}`);
    }

    // Safely construct customer name from available data
    const customerName = customer ? `${customer.firstName} ${customer.lastName}` : "Customer";

    return {
      customerEmail,
      customerName
    };
}
async function sendEmail(customerEmail: string, emailSubject: string, order: any, emailContent: string, logger: any) {
  if (!process.env.BREVO_API_TOKEN) {
    throw new ConfigurationError("Brevo API key is not configured");
  }

  const brevo = new TransactionalEmailsApi();
  const brevoApiKey = process.env.BREVO_API_TOKEN;
  const emailParams = {
    sender: {
      name: "MyOnClinic Shop",
      email: "marketing@myon.clinic",
    },
    to: [{email: customerEmail,},],
    subject: emailSubject,
    htmlContent: emailContent,
  };

  brevo.setApiKey(TransactionalEmailsApiApiKeys.apiKey, brevoApiKey);
  logger.info({ emailParams, orderName: order.name }, "Sending order email via Brevo");

  try {
    const response = await brevo.sendTransacEmail(emailParams);
    const messageId = response.body?.messageId || 'unknown';
    logger.info({ messageId, response }, "Email sent successfully via Brevo");
    return { messageId, ...response };
  } catch (error: any) {
    logger.error({ error }, "Error from Brevo API");
    throw new MailerError(
      `Failed to send email via Brevo: ${error?.message || "Unknown error"}`,
      error?.response?.status,
      error?.response?.data
    );
  }
}
async function logEmailSend(api: any, orderId: string, customerEmail: string, messageId: string, shopId: string, logger: any) {
  try {
    const emailLogRecord = await api.emailLog.create({
      orderId: orderId,
      emailType: "order_confirmation",
      emailAddress: customerEmail,
      sentAt: new Date().toISOString(),
      messageId: messageId,
      shop: { _link: shopId },
      status: "sent"
    });
    
    logger.info({ emailLogId: emailLogRecord.id, orderId, messageId }, "Email send logged successfully");
    return emailLogRecord;
  } catch (error: any) {
    logger.error({ error: error.message, orderId, messageId }, "Failed to log email send");
    // Don't throw here as the email was sent successfully, just log the error
  }
}
const route: RouteHandler = async ({request, reply, api, logger, connections}) => {
  try {
    const { orderId, shopId, items } = await validateInputs(request.body, connections);
    
    // Check for email duplication before proceeding
    await checkEmailDeduplication(api, orderId, shopId, logger);
    
    const { orderNumber, order, orderDate } = await getOrder(shopId, orderId, api, logger);   
    const { customerEmail, customerName } = await getCustomerData(api, order, logger); 
    const { subject: emailSubject, html: emailContent } = generateOrderEmailTemplate({orderNumber,orderDate,items,customerName,});
    const emailResult = await sendEmail(customerEmail, emailSubject, order, emailContent, logger);

    // Log the successful email send
    await logEmailSend(api, orderId, customerEmail, emailResult.messageId, shopId, logger);

    return await reply.code(200).send({
      success: true,
      message: `Order email sent to ${customerEmail}`,
      messageId: emailResult.messageId,
    });
    
  } catch (error) {
    // Handle specific error types
    if (error instanceof ValidationError) {
      logger.warn({ error: error instanceof ValidationError ? error.message : "Unknown error",}, "Validation error in order email request");
      return await reply.code(400).send({
        success: false,
        errorType: "validation_error",
        error: error instanceof ValidationError ? error.message : "Unknown error",
      });
    }
    
    if (error instanceof AuthenticationError) {
      logger.error({ error: error instanceof AuthenticationError ? error.message : "Unknown error", }, "Authentication error in order email request");
      return await reply.code(403).send({
        success: false,
        errorType: "authentication_error",
        error: error instanceof AuthenticationError ? error.message : "Unknown error",
      });
    }
    
    if (error instanceof ShopifyError) {
      logger.error({ error: error instanceof ShopifyError ? error.message : "Unknown error", }, "Shopify error in order email request");
      return await reply.code(404).send({
        success: false,
        errorType: "shopify_error",
        error: error instanceof ShopifyError ? error.message : "Unknown error",
      });
    }
    
    if (error instanceof MailerError) {
      logger.error({ 
        error: error instanceof MailerError ? error.message : "Unknown error",
        statusCode: error instanceof MailerError ? error.statusCode : "Unknown status code",
        details: error instanceof MailerError ? error.details : "Unknown Error Details",
      }, "Mailer error in order email request");
      return await reply.code(502).send({
        success: false,
        errorType: "mailer_error",
        error: error instanceof MailerError ? error.message : "Unknown error",
        statusCode: error instanceof MailerError ? error.statusCode : "Unknown status code",
        details: error instanceof MailerError ? error.details : "Unknown Error Details",
      });
    }
    
    if (error instanceof ConfigurationError) {
      logger.error({ error: error instanceof ConfigurationError ? error.message : "Unknown error" }, "Configuration error in order email request");
      return await reply.code(500).send({
        success: false,
        errorType: "configuration_error",
        error: error instanceof ConfigurationError ? error.message : "Unknown error"
      });
    }
    
    if (error instanceof DuplicationError) {
      logger.warn({ error: error instanceof DuplicationError ? error.message : "Unknown error" }, "Duplicate email request");
      return await reply.code(409).send({
        success: false,
        errorType: "duplication_error",
        error: error instanceof DuplicationError ? error.message : "Unknown error"
      });
    }
    
    logger.error({ 
      error: error instanceof Error ? error.message : "Unknown error",
      errorType: error instanceof Error ? error.name : "Unknown error type",
      stack: error instanceof Error ? error.stack : undefined
    }, "Unhandled error processing order email request");
    
    return await reply.code(500).send({
      success: false,
      errorType: "server_error",
      error: "Internal server error",
      message: error instanceof Error ? error.message : "Unknown error"
    });
  }
};
export default route;