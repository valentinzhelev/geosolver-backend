const { getFrontendUrl } = require('./appUrls');

const BRAND = 'GeoSolver';

const COLORS = {
  bg: '#fafaf9',
  card: '#ffffff',
  border: '#e7e5e4',
  text: '#1c1917',
  muted: '#78716c',
  faint: '#a8a29e',
  surface: '#f5f5f4',
  black: '#000000',
};

function escapeHtml(text) {
  if (typeof text !== 'string') return '';
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function getLogoUrl() {
  return `${getFrontendUrl()}/icons/white_logo.svg`;
}

function layout({
  title,
  preheader = '',
  bodyHtml,
  ctaUrl,
  ctaLabel,
  footerNote,
  showDisclaimer = true,
}) {
  const frontend = getFrontendUrl();
  const siteHost = frontend.replace(/^https?:\/\//, '');
  const logoUrl = getLogoUrl();
  const year = new Date().getFullYear();

  return `<!DOCTYPE html>
<html lang="bg" xmlns="http://www.w3.org/1999/xhtml">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <title>${escapeHtml(title)}</title>
  <!--[if mso]><style>body,table,td{font-family:Arial,Helvetica,sans-serif!important;}</style><![endif]-->
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700&display=swap');
    body { margin: 0 !important; padding: 0 !important; width: 100% !important; }
    .preheader { display: none !important; visibility: hidden; opacity: 0; color: transparent; height: 0; width: 0; max-height: 0; max-width: 0; overflow: hidden; mso-hide: all; }
    a { color: ${COLORS.black}; }
    @media only screen and (max-width: 620px) {
      .shell { padding: 20px 12px !important; }
      .card { border-radius: 10px !important; }
      .body-pad { padding: 24px 20px !important; }
      .header-pad { padding: 22px 20px !important; }
      .cta-btn { display: block !important; width: 100% !important; text-align: center !important; box-sizing: border-box !important; }
    }
  </style>
</head>
<body style="margin:0;padding:0;background-color:${COLORS.bg};font-family:'Manrope',Arial,Helvetica,sans-serif;-webkit-font-smoothing:antialiased;">
  ${preheader ? `<span class="preheader">${escapeHtml(preheader)}</span>` : ''}
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="shell" style="background-color:${COLORS.bg};padding:40px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="card" style="max-width:560px;background-color:${COLORS.card};border:1px solid ${COLORS.border};border-radius:12px;overflow:hidden;">
          <!-- Header -->
          <tr>
            <td class="header-pad" style="padding:24px 28px;background-color:${COLORS.black};background-image:linear-gradient(135deg,#292524 0%,#000000 55%,#1c1917 100%);">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td align="center">
                    <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                      <tr>
                        <td style="padding-right:10px;vertical-align:middle;">
                          <img src="${logoUrl}" width="36" height="36" alt="${BRAND}" style="display:block;border:0;outline:none;border-radius:9px;">
                        </td>
                        <td style="vertical-align:middle;">
                          <span style="color:#ffffff;font-size:18px;font-weight:700;letter-spacing:-0.02em;font-family:'Manrope',Arial,Helvetica,sans-serif;">${BRAND}</span>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <!-- Body -->
          <tr>
            <td class="body-pad" style="padding:32px 28px;color:${COLORS.text};font-size:15px;line-height:1.65;font-family:'Manrope',Arial,Helvetica,sans-serif;">
              <h1 style="margin:0 0 18px;font-size:22px;font-weight:700;line-height:1.3;color:${COLORS.black};letter-spacing:-0.02em;">${escapeHtml(title)}</h1>
              ${bodyHtml}
              ${ctaUrl ? `
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:28px 0 0;">
                <tr>
                  <td>
                    <a href="${ctaUrl}" class="cta-btn" style="display:inline-block;background-color:${COLORS.black};color:#ffffff;text-decoration:none;padding:13px 28px;border-radius:8px;font-size:14px;font-weight:600;font-family:'Manrope',Arial,Helvetica,sans-serif;">${escapeHtml(ctaLabel || 'Отвори GeoSolver')}</a>
                  </td>
                </tr>
              </table>` : ''}
              ${showDisclaimer ? `<p style="margin:28px 0 0;font-size:12px;line-height:1.5;color:${COLORS.faint};">Ако не сте заявили това действие, можете спокойно да игнорирате този имейл.</p>` : ''}
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="padding:18px 28px;background-color:${COLORS.surface};border-top:1px solid ${COLORS.border};font-size:12px;line-height:1.5;color:${COLORS.muted};font-family:'Manrope',Arial,Helvetica,sans-serif;">
              <p style="margin:0 0 6px;">© ${year} ${BRAND}</p>
              <p style="margin:0;">
                <a href="${frontend}" style="color:${COLORS.muted};text-decoration:underline;">${siteHost}</a>
                ${footerNote ? ` · ${footerNote}` : ''}
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function infoBox(html) {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:20px 0 0;">
    <tr>
      <td style="padding:16px 18px;background-color:${COLORS.surface};border:1px solid ${COLORS.border};border-radius:8px;font-size:14px;line-height:1.6;color:${COLORS.text};">
        ${html}
      </td>
    </tr>
  </table>`;
}

function linkFallback(url) {
  return `<p style="margin:16px 0 0;font-size:12px;line-height:1.5;color:${COLORS.muted};">
    Ако бутонът не работи, копирайте този линк в браузъра си:<br>
    <a href="${url}" style="color:${COLORS.muted};word-break:break-all;">${escapeHtml(url)}</a>
  </p>`;
}

function verificationEmail({ name, verifyUrl }) {
  const safeName = escapeHtml(name || '');
  return {
    subject: 'Потвърждение на имейл в GeoSolver',
    html: layout({
      title: 'Потвърдете имейла си',
      preheader: 'Завършете регистрацията си в GeoSolver с един клик.',
      bodyHtml: `
        <p style="margin:0 0 14px;">Здравей${safeName ? `, <strong>${safeName}</strong>` : ''},</p>
        <p style="margin:0 0 14px;">Благодарим, че се регистрирахте в GeoSolver. Потвърдете имейл адреса си, за да активирате акаунта.</p>
        ${infoBox('<strong>Следваща стъпка:</strong> натиснете бутона по-долу. Линкът е валиден, докато не потвърдите имейла.')}
        ${linkFallback(verifyUrl)}`,
      ctaUrl: verifyUrl,
      ctaLabel: 'Потвърди имейл',
    }),
  };
}

function resetPasswordEmail({ name, resetUrl }) {
  const safeName = escapeHtml(name || '');
  return {
    subject: 'Възстановяване на парола в GeoSolver',
    html: layout({
      title: 'Смяна на парола',
      preheader: 'Заявихте смяна на паролата си в GeoSolver.',
      bodyHtml: `
        <p style="margin:0 0 14px;">Здравей${safeName ? `, <strong>${safeName}</strong>` : ''},</p>
        <p style="margin:0 0 14px;">Получихме заявка за нова парола за вашия GeoSolver акаунт.</p>
        ${infoBox('<strong>Важно:</strong> линкът е валиден <strong>30 минути</strong>. След изтичане ще трябва да заявите нов.')}
        ${linkFallback(resetUrl)}`,
      ctaUrl: resetUrl,
      ctaLabel: 'Задай нова парола',
    }),
  };
}

function contactFormEmail({ senderEmail, title, content }) {
  const safeTitle = escapeHtml(title);
  const safeContent = escapeHtml(content).replace(/\n/g, '<br>');
  const safeEmail = escapeHtml(senderEmail);
  return {
    subject: `[GeoSolver] Контактна форма: ${title.slice(0, 100)}`,
    html: layout({
      title: safeTitle,
      preheader: `Ново съобщение от ${senderEmail}`,
      bodyHtml: `
        <p style="margin:0 0 14px;color:${COLORS.muted};font-size:13px;text-transform:uppercase;letter-spacing:0.04em;font-weight:600;">Контактна форма</p>
        <div style="margin:0 0 14px;white-space:pre-wrap;">${safeContent}</div>
        ${infoBox(`<strong style="color:${COLORS.black};">От:</strong> <a href="mailto:${safeEmail}" style="color:${COLORS.black};text-decoration:none;">${safeEmail}</a>`)}`,
      showDisclaimer: false,
      footerNote: 'Изпратено от geosolver.bg/contacts',
    }),
  };
}

function notificationEmail({ name, title, body, link }) {
  const safeName = escapeHtml(name || '');
  const safeTitle = escapeHtml(title);
  const safeBody = escapeHtml(body || title);
  const appUrl = getFrontendUrl();
  const fullLink = link?.startsWith('http') ? link : `${appUrl}${link || ''}`;
  return {
    subject: `GeoSolver — ${title}`,
    html: layout({
      title: safeTitle,
      preheader: body || title,
      bodyHtml: `
        <p style="margin:0 0 14px;">Здравей${safeName ? `, <strong>${safeName}</strong>` : ''},</p>
        <p style="margin:0;">${safeBody}</p>`,
      ctaUrl: fullLink || null,
      ctaLabel: 'Отвори в GeoSolver',
      footerNote: 'GeoSolver Edu',
    }),
  };
}

function adminNotificationEmail({ title, body }) {
  return {
    subject: `GeoSolver — ${title}`,
    html: layout({
      title: escapeHtml(title),
      bodyHtml: `<p style="margin:0;">${escapeHtml(body)}</p>
        ${infoBox('Прегледайте заявката в <strong>Account → Admin</strong>.')}`,
      ctaUrl: `${getFrontendUrl()}/account`,
      ctaLabel: 'Отвори админ панела',
      showDisclaimer: false,
    }),
  };
}

function workspaceInviteEmail({
  recipientName,
  workspaceName,
  inviterName,
  role,
  inviteCode,
  hasAccount,
}) {
  const safeName = escapeHtml(recipientName || '');
  const safeWs = escapeHtml(workspaceName || 'Workspace');
  const safeInviter = escapeHtml(inviterName || '');
  const safeRole = escapeHtml(role || 'editor');
  const safeCode = escapeHtml(inviteCode || '');
  const frontend = getFrontendUrl();
  const joinUrl = hasAccount
    ? `${frontend}/workspace`
    : `${frontend}/register?invite=${encodeURIComponent(inviteCode || '')}`;
  const ctaLabel = hasAccount ? 'Отвори Workspace' : 'Регистрирай се и се присъедини';

  return {
    subject: `Покана за workspace „${workspaceName || 'GeoSolver'}“`,
    html: layout({
      title: 'Покана за workspace',
      preheader: `${inviterName || 'Колега'} ви кани в ${workspaceName || 'GeoSolver workspace'}.`,
      bodyHtml: `
        <p style="margin:0 0 14px;">Здравей${safeName ? `, <strong>${safeName}</strong>` : ''},</p>
        <p style="margin:0 0 14px;">
          ${safeInviter ? `<strong>${safeInviter}</strong> ви кани` : 'Получихте покана'}
          в workspace <strong>${safeWs}</strong> с роля <strong>${safeRole}</strong>.
        </p>
        ${
          inviteCode
            ? infoBox(
                `<strong>Invite код:</strong> <span style="font-family:ui-monospace,monospace;letter-spacing:0.06em;">${safeCode}</span>`
              )
            : ''
        }
        ${
          hasAccount
            ? '<p style="margin:14px 0 0;">Вече сте добавени към workspace. Отворете GeoSolver, за да започнете работа.</p>'
            : '<p style="margin:14px 0 0;">Нямате акаунт още — регистрирайте се и въведете invite кода в Workspace.</p>'
        }
        ${linkFallback(joinUrl)}`,
      ctaUrl: joinUrl,
      ctaLabel,
    }),
  };
}

module.exports = {
  layout,
  verificationEmail,
  resetPasswordEmail,
  contactFormEmail,
  notificationEmail,
  adminNotificationEmail,
  workspaceInviteEmail,
  escapeHtml,
};
