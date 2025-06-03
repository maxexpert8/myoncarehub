/**
 * Email template generator for order notifications
 * Supports different email types with configurable parameters
 */

interface OrderItem {
  id: string;
  longURL: string;
  shortUrl: string;
  quantity: number;
  lineItemPic: string;
}
interface OrderEmailData {
  customerName: string;
  orderNumber: string;
  orderDate: string;
  items: [OrderItem];
}
interface EmailTemplate {
  subject: string;
  html: string;
}

/**
 * Generates an HTML email template for order notifications
 * 
 * @param emailType - Type of email notification to generate
 * @param data - Order data and customer information
 * @returns Object containing email subject and HTML content
 */
export const generateOrderEmailTemplate = (data: OrderEmailData): EmailTemplate => {
  // Generate the order items table
  const generateOrderItemsTable = (): string => {
    let itemsHtml = data.items.map(item => `
      <tr class="order-list__item" style="width: 100%;">
        <td style="font-family: -apple-system,Helvetica,sans-serif; padding: 15px;"></td>
        <td style="font-family: -apple-system,Helvetica,sans-serif; width: 100%; padding: 15px;">
          <span style="font-size: 16px; font-weight: 600; line-height: 1.4; color: #555;">
            <strong style="font-size: 16px; color: #555;">${item.id}</strong>
          </span><br><br>
          <span style="font-size: 16px;">
            <span style="font-size: small;">Anzahl der Lizenzen:</span> ${item.quantity}
          </span><br>
          <span style="font-size: 16px;">
            <span style="font-size: small;">Aktivierungslink:</span> 
            <a href="${item.shortUrl}" style="color: #4b33ff; font-size: 16px; text-decoration: none;">hier klicken</a>
          </span><br>
        </td>
        <td style="font-family: -apple-system,Helvetica,sans-serif; padding: 15px 0;" valign="middle">
          <img src="${item.lineItemPic}" alt="${item.id}" align="left" width="60" style="margin-right: 15px; border: 1px solid #e5e5e5;">
        </td>
      </tr>
    `).join('');

    return `
      <table class="row" style="width: 100%; border-spacing: 0; border-collapse: collapse;" bgcolor="#f3f3f3">
        <tbody>
          ${itemsHtml}
        </tbody>
      </table>
    `;
  };

  // Assemble the complete email template
  const subject = "Ihre Aktivierungslinks von myon.clinic";
  const shopLogoUrl = "https://cdn.shopify.com/s/files/1/0863/0622/6507/files/myon.clinic_1.svg?v=1746697557";
  const shopName = "myon.clinic";
  const html = `
    <html>
      <head>
        <meta http-equiv="Content-Type" content="text/html; charset=UTF-8">
        <title>${subject}</title>
        <meta name="viewport" content="width=device-width">
        <style>
          body{margin: 0;}
          @media (max-width: 600px) {
            .container{width: 94% !important;}
            .main-action-cell {
              float: none !important;
              margin-right: 0 !important;
            }
            .secondary-action-cell {
              text-align: center;
              width: 100%;
            }
            .header {
              margin-top: 20px !important;
              margin-bottom: 2px !important;
            }
            .shop-name__cell{display: block;}
            .order-number__cell {
              display: block;
              text-align: left !important;
              margin-top: 20px;
            }
            .po-number__cell {
              display: block;
              text-align: left !important;
              margin-top: 5px;
            }
            .button{width: 100%;}
            .customer-info__item {
              display: block;
              width: 100% !important;
            }
            .spacer{display: none;}
            .subtotal-spacer{display: none;}
            .return__mobile-padding {
              margin-top: 19px;
              padding-top: 19px;
            }
          }
        </style>
      </head>
      <body style="margin: 0;">
        <table class="body"
          style="height: 100% !important; width: 100% !important; border-spacing: 0; border-collapse: collapse;">
          <tbody>
            <tr>
              <td
                style="font-family: -apple-system,Helvetica,sans-serif;">
                <table class="headerEmail row"
                  style="margin-bottom: 40px; width: 100%; border-spacing: 0; border-collapse: collapse;">
                  <tbody>
                    <tr>
                      <td class="header__cell"
                        style="font-family: -apple-system,Helvetica,sans-serif;">
                        <center>
                          <table class="container"
                            style="max-width: 90%; height: 100px; width: 560px; text-align: left; border-spacing: 0; border-collapse: collapse; margin: 30px auto 0;"
                            bgcolor="#4b33ff">
                            <tbody>
                              <tr>
                                <td
                                  style="font-family: -apple-system,Helvetica,sans-serif;">
                                  <table class="row" style="width: 100%; border-spacing: 0; border-collapse: collapse;">
                                    <tbody>
                                      <tr>
                                        <td class="shop-name__cell"
                                          style="font-family: -apple-system,Helvetica,sans-serif;">
                                          <center><img
                                              src="${shopLogoUrl}"
                                              alt="${shopName}" width="180"></center>
                                        </td>
                                      </tr>
                                    </tbody>
                                  </table>
                                </td>
                              </tr>
                            </tbody>
                          </table>
                        </center>
                      </td>
                    </tr>
                  </tbody>
                </table>
                <table class="row content" style="width: 100%; border-spacing: 0; border-collapse: collapse;">
                  <tbody>
                    <tr>
                      <td class="content__cell"
                        style="font-family: -apple-system,Helvetica,sans-serif; padding-bottom: 40px; border-width: 0;">
                        <center>
                          <table class="container"
                            style="width: 560px; text-align: left; border-spacing: 0; border-collapse: collapse; margin: 0 auto;">
                            <tbody>
                              <tr>
                                <td
                                  style="font-family: -apple-system,Helvetica,sans-serif;">
                                  <p style="color: #777; line-height: 150%; font-size: 16px; margin: 0;" align="right">
                                    <strong style="font-size: 16px; color: #555;">Auftragsdatum:</strong> <span
                                      style="display: inline-block; min-width: 90px; font-size: 16px;">${data.orderDate}</span>
                                    <br>
                                    <strong style="font-size: 16px; color: #555;">Auftragsnummer:</strong> <span
                                      style="display: inline-block; min-width: 90px; font-size: 16px;">${data.orderNumber}</span>
                                  </p>
                                  <p style="color: #777; line-height: 150%; font-size: 16px; margin: 15px 0 0;">Hallo ${data.customerName},
                                  </p>
                                  <p style="color: #777; line-height: 150%; font-size: 16px; margin: 15px 0 0;">vielen Dank
                                    für Ihre Bestellung bei myon.clinic!</p>
                                  <br>
                                  <h3 style="font-weight: normal; font-size: 20px; margin: 0 0 12.5px;"><strong
                                      style="font-size: 16px; color: #555;">Hier finden Sie Ihre Aktivierungslinks:</strong>
                                  </h3>
                                  <p style="font-size: smaller; color: #777; line-height: 150%; margin: 0;"><strong
                                      style="color: #5b40f4; font-size: small;">Wichtiger Hinweis:</strong> Der Link kann nur
                                    so oft aufgerufen werden, wie Sie das Produkt erworben haben. Haben Sie beispielsweise
                                    zwei Einheiten eines Behandlungspfads gekauft, ist der Link maximal zweimal nutzbar.
                                    Danach verliert er seine Gültigkeit. Bitte schließen Sie die Registrierung nach dem Klick
                                    auf den Link unbedingt vollständig ab. Bei Fragen oder Problemen wenden Sie sich gerne an
                                    <a href="mailto:service@myoncare.com"style="color: #5b40f4;"">service@myoncare.com</a>.</p>
                                </td>
                              </tr>
                            </tbody>
                          </table>
                        </center>
                      </td>
                    </tr>
                  </tbody>
                </table>
                <table class="row section" style="width: 100%; border-spacing: 0; border-collapse: collapse;">
                  <tbody>
                    <tr>
                      <td class="section__cell"
                        style="font-family: -apple-system,Helvetica,sans-serif; padding: 0;">
                        <center>
                          <table class="container"
                            style="width: 560px; text-align: left; border-spacing: 0; border-collapse: collapse; margin: 0 auto;">
                            <tbody>
                              <tr>
                                <td
                                  style="font-family: -apple-system,Helvetica,sans-serif;">
                                  ${generateOrderItemsTable()}
                                  
                                </td>
                              </tr>
                              <tr>
                                <td
                                  style="font-family: -apple-system,Helvetica,sans-serif;">
                                  <p style="color: #777; line-height: 150%; font-size: 16px; margin: 15px 0 25px;">Viel Spaß
                                    mit Ihren digitalen Pfaden,<br><strong style="font-size: 16px; color: #555;">Ihr
                                      myon.clinic-Team</strong></p>
                                </td>
                              </tr>
                            </tbody>
                          </table>
                        </center>
                      </td>
                    </tr>
                  </tbody>
                </table>
                <table class="row footer"
                  style="width: 100%; border-spacing: 0; border-collapse: collapse; border-top-width: 1px; border-top-color: #e5e5e5; border-top-style: solid;">
                  <tbody>
                    <tr>
                      <td class="footer__cell"
                        style="font-family: -apple-system,Helvetica,sans-serif; padding: 35px 0;">
                        <center>
                          <table class="container"
                            style="width: 560px; text-align: left; border-spacing: 0; border-collapse: collapse; margin: 0 auto;">
                            <tbody>
                              <tr>
                                <td
                                  style="font-family: -apple-system,Helvetica,sans-serif;">
                                  <p class="disclaimer__subtext"
                                    style="color: #999; line-height: 150%; font-size: 14px; margin: 0;"><span
                                      style="font-size: 16px;"><strong
                                        style="font-size: 16px; color: #555;">Impressum</strong></span></p>
                                  <p class="disclaimer__subtext"
                                    style="font-size: small; color: #999; line-height: 150%; margin: 15px 0 0;">
                                    <span style="font-size: 16px;">myon.clinic GmbH</span>
                                    <span style="font-size: 16px;">Balanstraße 71a,</span><br>
                                    <span style="font-size: 16px;">D-81541 Munich</span><br>
                                    <span style="font-size: 16px;">www.myon.clinic</span>
                                  </p>
                                  <p class="disclaimer__subtext"
                                    style="font-size: small; color: #999; line-height: 150%; margin: 15px 0 0;">
                                    <span style="font-size: 16px;">Vertreten durch: Katharina Hieronimi</span><br>
                                    <span style="font-size: 16px;">Steuer-ID: DE357709921</span><br>
                                    <span style="font-size: 16px;">Handelsregisternummer: HRB 280310, Registergericht
                                      München</span>
                                  </p>
                                  <p class="disclaimer__subtext"
                                    style="padding-bottom: 16px; color: #999; line-height: 150%; font-size: 14px; margin: 15px 0 0;">
                                    <a style="color: #4b33ff; text-decoration: underline; font-size: 14px;">Datenschutz</a>
                                    <a style="color: #4b33ff; text-decoration: underline; font-size: 14px;">AGB</a>
                                  </p>

                                </td>
                              </tr>
                            </tbody>
                          </table>
                        </center>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </td>
            </tr>
          </tbody>
        </table>
      </body>
      </html>
  `;
  
  return {
    subject,
    html
  };
};

/**
 * Utility function to format currency values consistently
 * 
 * @param amount - The amount to format
 * @param currencyCode - The currency code (e.g., USD, EUR)
 * @returns Formatted currency string
 */
export const formatCurrency = (amount: number | string, currencyCode: string = 'USD'): string => {
  const numericAmount = typeof amount === 'string' ? parseFloat(amount) : amount;
  
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currencyCode,
  }).format(numericAmount);
};

/**
 * Formats a date string into a readable format
 * 
 * @param dateString - The date string to format
 * @returns Formatted date string
 */
export const formatDate = (dateString: string | Date): string => {
  const date = typeof dateString === 'string' ? new Date(dateString) : dateString;
  
  return new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
  }).format(date);
};