const { getFrontendUrl } = require('./appUrls');

const BRAND = 'GeoSolver';

function layout({ title, bodyHtml, ctaUrl, ctaLabel }) {
  const frontend = getFrontendUrl();
  return `<!DOCTYPE html>
<html lang="bg">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head>
<body style="margin:0;padding:0;background:#f5f5f4;font-family:Arial,Helvetica,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f4;padding:32px 16px;">
    <tr><td align="center">
      <table width="100%" style="max-width:560px;background:#fff;border:1px solid #e7e5e4;border-radius:12px;overflow:hidden;">
        <tr><td style="background:#000;padding:20px 24px;">
          <span style="color:#fff;font-size:18px;font-weight:bold;">${BRAND}</span>
        </td></tr>
        <tr><td style="padding:28px 24px;color:#1c1917;font-size:15px;line-height:1.6;">
          <h1 style="margin:0 0 16px;font-size:20px;color:#000;">${title}</h1>
          ${bodyHtml}
          ${ctaUrl ? `<p style="margin:24px 0 0;"><a href="${ctaUrl}" style="display:inline-block;background:#000;color:#fff;text-decoration:none;padding:12px 24px;border-radius:8px;font-weight:600;">${ctaLabel || 'Отвори GeoSolver'}</a></p>` : ''}
          <p style="margin:28px 0 0;font-size:12px;color:#a8a29e;">Ако не сте заявили това действие, игнорирайте този имейл.</p>
        </td></tr>
        <tr><td style="padding:16px 24px;background:#fafaf9;border-top:1px solid #e7e5e4;font-size:11px;color:#a8a29e;">
          © ${new Date().getFullYear()} ${BRAND} · <a href="${frontend}" style="color:#78716c;">${frontend.replace(/^https?:\/\//, '')}</a>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

function verificationEmail({ name, verifyUrl }) {
  return {
    subject: 'Потвърждение на имейл в GeoSolver',
    html: layout({
      title: 'Потвърдете имейла си',
      bodyHtml: `<p>Здравей${name ? `, ${name}` : ''},</p>
        <p>Благодарим за регистрацията в GeoSolver! Кликнете бутона по-долу, за да потвърдите имейл адреса си.</p>
        <p style="font-size:12px;color:#78716c;word-break:break-all;">${verifyUrl}</p>`,
      ctaUrl: verifyUrl,
      ctaLabel: 'Потвърди имейл',
    }),
  };
}

function resetPasswordEmail({ name, resetUrl }) {
  return {
    subject: 'Възстановяване на парола в GeoSolver',
    html: layout({
      title: 'Смяна на парола',
      bodyHtml: `<p>Здравей${name ? `, ${name}` : ''},</p>
        <p>Получихме заявка за смяна на паролата ви. Линкът е валиден <strong>30 минути</strong>.</p>
        <p style="font-size:12px;color:#78716c;word-break:break-all;">${resetUrl}</p>`,
      ctaUrl: resetUrl,
      ctaLabel: 'Задай нова парола',
    }),
  };
}

function contactFormEmail({ senderEmail, title, content }) {
  return {
    subject: `[GeoSolver] Контактна форма: ${title.slice(0, 100)}`,
    html: layout({
      title: title,
      bodyHtml: `<p style="white-space:pre-wrap;">${content}</p>
        <p style="margin-top:16px;padding:12px;background:#f5f5f4;border-radius:8px;">
          <strong>От:</strong> ${senderEmail}
        </p>`,
    }),
  };
}

module.exports = {
  layout,
  verificationEmail,
  resetPasswordEmail,
  contactFormEmail,
};
