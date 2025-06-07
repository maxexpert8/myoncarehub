import { ActionOptions, ShopifyOrdersPaidTrigger } from "gadget-server";
import { processLineItems, saveOrderMetafield, sendOrderEmail } from "../lib/flowHelpers";

// TypeScript interfaces for better type safety
interface ProcessedLineItem {
  id: string;
  name: string;
  quantity: number;
  image: string;
  shortUrl: string;
  longURL: string;
}

interface ProcessingResult {
  success: boolean;
  shortUrls: string[];
  lineItemsName: string[];
  lineItems: ProcessedLineItem[];
}

interface ShortUrlMapping {
  lineItemId: string;
  shortUrl: string;
}

interface PerformanceTimer {
  start: number;
  lastStep: number;
  step(stepName: string): void;
}

const createTimer = (logger: any): PerformanceTimer => {
  const start = Date.now();
  return {
    start,
    lastStep: start,
    step(stepName: string) {
      const now = Date.now();
      const stepElapsed = now - this.lastStep;
      const totalElapsed = now - this.start;
      logger.debug({ stepName, stepElapsedMs: stepElapsed, totalElapsedMs: totalElapsed }, `Performance: ${stepName} completed`);
      this.lastStep = now;
    }
  };
};

export const run: ActionRun = async ({ api, logger, trigger, connections }) => {
  const timer = createTimer(logger);

  try {
    logger.info({ trigger: trigger?.type }, "Received order webhook trigger");
    
    // 1. BASIC VALIDATION
    const orderData = (trigger as ShopifyOrdersPaidTrigger).payload;
    if (!orderData?.id || !orderData?.email || !orderData?.line_items) {
      logger.error({ 
        hasId: !!orderData?.id,
        hasEmail: !!orderData?.email, 
        hasLineItems: !!orderData?.line_items 
      }, "Invalid order webhook payload: missing required fields");
      throw new Error("Invalid order webhook payload");
    }

    const orderId = orderData.id.toString();
    const orderName = orderData.name;
    const customerEmail = orderData.email;

    // Get shop context early
    const shopId = connections.shopify.currentShopId?.toString();
    if (!shopId) {
      logger.error("Shop ID not found in connections context");
      throw new Error("Shop ID not found in connections context");
    }

    logger.info({ 
      orderId, 
      orderName, 
      customerEmail, 
      shopId,
      lineItemCount: orderData.line_items?.length || 0
    }, "Processing order webhook");

    timer.step("Initial validation");

    // 2. CHECK FOR DUPLICATE PROCESSING (MOVED TO BEGINNING)
    const existingOrderHistoryResults = await api.emailLog.findMany({
      filter: {
        orderId: { equals: orderId },
        shopId: { equals: shopId }
      },
      first: 1
    });

    if (existingOrderHistoryResults.length > 0) {
      logger.warn({ 
        orderId, 
        existingRecordId: existingOrderHistoryResults[0].id 
      }, "Order already processed, skipping");
      return {
        success: true,
        message: "Order already processed",
        orderId,
        alreadyProcessed: true
      };
    }

    timer.step("Duplicate check");

    // 3. SETUP SHOP AND CONNECTIONS
    const shop = await api.shopifyShop.findById(shopId);
    if (!shop) {
      logger.error({ shopId }, "Shop record not found");
      throw new Error("Shop record not found");
    }

    const shopify = await connections.shopify.forShopId(shopId);
    timer.step("Shop setup");

    // 4. PROCESS LINE ITEMS WITH ERROR RECOVERY
    const lineItemsForProcessing: ProcessedLineItem[] = [];
    let processingResult: ProcessingResult;
    let shortUrlMappings: ShortUrlMapping[] = [];
    let urlProcessingSucceeded = false;
    
    try {
      logger.info({ count: orderData.line_items.length }, "Fetching product data for line items");
      
      for (const item of orderData.line_items) {
        try {
          if (!item.product_id) {
            logger.warn({ 
              itemId: item.id, 
              itemName: item.name || item.title,
              productId: item.product_id
            }, "Line item has no valid product_id, skipping product data fetch");
            
            // Add fallback item without trying to fetch product data
            lineItemsForProcessing.push({
              id: item.id.toString(),
              name: item.name || item.title || "Custom Item",
              quantity: item.quantity,
              image: "",
              shortUrl: '',
              longURL: ""
            });
            continue; // Skip to next item
          }
          let product =  await api.shopifyProduct.findFirst({
            filter: {
              id: { equals: item.product_id.toString() },
            },
            select: {
              id: true,
              title: true,
              pathwayLongurl: true,
              featuredMedia: {
                file: {
                  image: true
                }
              }
            }
          });
          logger.info({ product }, "Fetched product data for line item");
          let image = product?.featuredMedia?.file?.image;
          let imageUrl = "";
          if (image && typeof image === "object" && "originalSrc" in image) {
            imageUrl = (image as { originalSrc: string }).originalSrc;
          }
          let longURL = product?.pathwayLongurl || "";
          logger.info({ image, imageUrl, longURL }, "Product image data processed");

          lineItemsForProcessing.push({
            id: item.id.toString(),
            name: item.name || product.title || "Unknown Product",
            quantity: item.quantity,
            image: imageUrl,
            shortUrl: '', // Will be populated by processLineItems
            longURL: longURL
          });
        } catch (productError) {
          logger.warn({ 
            itemId: item.id, 
            productId: item.product_id,
            error: productError instanceof Error ? productError.message : "Unknown error"
          }, "Failed to fetch product data for line item, using fallback");
          
          // Add fallback item so processing can continue
          lineItemsForProcessing.push({
            id: item.id.toString(),
            name: item.name || item.title || "Unknown Product",
            quantity: item.quantity,
            image: "",
            shortUrl: '',
            longURL: ""
          });
        }
      }

      timer.step("Product data fetching");

      try {
        processingResult = await processLineItems(lineItemsForProcessing, logger);
        
        if (!processingResult || typeof processingResult.success !== 'boolean') {
          throw new Error("Invalid processing result structure");
        }

        if (processingResult.success && processingResult.shortUrls && processingResult.lineItemsName) {
          // Validate arrays have same length
          if (processingResult.shortUrls.length !== processingResult.lineItemsName.length) {
            throw new Error("Mismatch between shortUrls and lineItemsName arrays");
          }

          shortUrlMappings = processingResult.shortUrls.map((url, index) => ({
            lineItemId: processingResult.lineItemsName[index],
            shortUrl: url
          }));
          
          urlProcessingSucceeded = true;
          logger.info({ 
            orderId, 
            urlCount: shortUrlMappings.length 
          }, "Successfully processed line item URLs");
        } else {
          throw new Error("URL processing failed or returned invalid results");
        }

        timer.step("Line item processing");

        // Save metafield with error recovery
        if (urlProcessingSucceeded && shortUrlMappings.length > 0) {
          try {
            const { saveSuccess } = await saveOrderMetafield(
              shop.domain ?? "", 
              orderId, 
              shortUrlMappings, 
              logger
            );
            
            if (!saveSuccess) {
              logger.warn({ orderId }, "Failed to save short URL mapping as order metafield");
            } else {
              logger.info({ orderId }, "Successfully saved short URL mappings to order metafield");
            }
          } catch (metafieldError) {
            logger.warn({ 
              orderId,
              error: metafieldError instanceof Error ? metafieldError.message : "Unknown error"
            }, "Failed to save order metafield, continuing with email processing");
          }
        }

        timer.step("Metafield saving");

      } catch (urlError) {
        logger.warn({ 
          orderId,
          error: urlError instanceof Error ? urlError.message : "Unknown error"
        }, "URL processing failed, continuing with email using original line items");
        
        // Create fallback processing result
        processingResult = {
          success: false,
          shortUrls: [],
          lineItemsName: [],
          lineItems: lineItemsForProcessing
        };
      }
    } catch (lineItemError) {
      logger.error({ 
        orderId,
        error: lineItemError instanceof Error ? lineItemError.message : "Unknown error"
      }, "Failed to process line items completely");
      throw new Error("Critical failure in line item processing");
    }

    // 5. FIND CUSTOMER
    let customer = null;
    if (orderData.customer?.id) {
      try {
        const customerResults = await api.shopifyCustomer.findMany({
          filter: {
            legacyResourceId: { equals: orderData.customer.id.toString() },
            shopId: { equals: shopId }
          },
          first: 1
        });
        
        customer = customerResults.length > 0 ? customerResults[0] : null;
            
        if (customer) {
          logger.debug({ customerId: customer.id, orderId }, "Found existing customer record");
        }
      } catch (customerError) {
        logger.warn({ 
          orderId,
          customerId: orderData.customer.id,
          error: customerError instanceof Error ? customerError.message : "Unknown error"
        }, "Failed to lookup customer, continuing without customer link");
      }
    }

    timer.step("Customer lookup");

    // 6. SEND ORDER CONFIRMATION EMAIL
    let emailMessageId: string | null = null;
    let emailSent = false;

    try {
      const customerName = orderData.customer?.first_name && orderData.customer?.last_name
        ? `${orderData.customer.first_name} ${orderData.customer.last_name}`
        : orderData.customer?.first_name || "Valued Customer";

      logger.info({ 
        orderId, 
        customerName, 
        customerEmail,
        lineItemCount: processingResult?.lineItems?.length || 0
      }, "Attempting to send order confirmation email");

      const emailResult = await sendOrderEmail(
        orderData, 
        processingResult?.lineItems || [], 
        customerName, 
        logger
      );

      if (!emailResult || typeof emailResult.success !== 'boolean') {
        throw new Error("Invalid email result structure");
      }

      emailMessageId = emailResult.messageId;
      emailSent = emailResult.success;

      if (emailSent) {
        logger.info({ 
          orderId, 
          messageId: emailMessageId,
          customerEmail
        }, "Order confirmation email sent successfully");
      } else {
        logger.warn({ 
          orderId, 
          messageId: emailMessageId,
          customerEmail
        }, "Email sending reported as failed");
      }

      timer.step("Email sending");

    } catch (emailError) {
      logger.error({ 
        orderId, 
        customerEmail,
        error: emailError instanceof Error ? emailError.message : "Unknown email error",
        stack: emailError instanceof Error ? emailError.stack : undefined
      }, "Failed to send order confirmation email");
    }

    // 7. LOG EMAIL ATTEMPT
    try {
      await api.emailLog.create({
        emailAddress: customerEmail,
        emailType: "order_confirmation",
        messageId: emailMessageId || `failed-${Date.now()}`,
        orderId,
        sentAt: new Date(),
        shop: { _link: shopId },
        status: emailSent ? "sent" : "failed"
      });

      logger.debug({ 
        orderId, 
        emailSent, 
        messageId: emailMessageId 
      }, "Created email log entry");

      timer.step("Email logging");

    } catch (logError) {
      logger.error({ 
        orderId, 
        error: logError instanceof Error ? logError.message : "Unknown log error",
        stack: logError instanceof Error ? logError.stack : undefined
      }, "Failed to create email log entry");
    }

    // 8. RETURN SUCCESS RESPONSE
    const totalElapsedMs = Date.now() - timer.start;
    
    logger.info({ 
      orderId,
      totalProcessingTimeMs: totalElapsedMs,
      emailSent,
      urlProcessingSucceeded: urlProcessingSucceeded || false
    }, "Order webhook processing completed");

    return {
      success: true,
      message: "Order webhook processed successfully",
      orderId,
      orderName,
      emailSent,
      emailMessageId,
      customerEmail,
      totalPrice: orderData.total_price,
      currency: orderData.currency,
      processingTimeMs: totalElapsedMs,
      urlProcessingSucceeded: urlProcessingSucceeded || false
    };

  } catch (error) {
    const totalElapsedMs = Date.now() - timer.start;
    
    logger.error({ 
      error: error instanceof Error ? error.message : "Unknown error",
      stack: error instanceof Error ? error.stack : undefined,
      triggerType: trigger?.type,
      processingTimeMs: totalElapsedMs
    }, "Error processing order webhook");

    throw error;
  }
};

export const options: ActionOptions = {
  triggers: {
    shopify: {
      webhooks: ["orders/paid"]
    }
  }
};
