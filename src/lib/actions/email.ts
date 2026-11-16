// Server-only helpers. Deliberately NOT 'use server': these must not be
// callable from the browser (they send email with caller-supplied content).

import nodemailer from 'nodemailer'
import { Resend } from 'resend'
import { getSetting } from '@/lib/local-data'
import type { Task, SessionUser, BrandingSettings, EmailSettings } from '@/lib/types'
import { formatDateTime } from '@/lib/utils'

let transporterPromise: Promise<nodemailer.Transporter> | null = null
let resendClient: Resend | null = null

/** Escape user-supplied text before putting it in an email's HTML. */
function escapeHtml(value: string | null | undefined): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function cleanEnvValue(value: string | undefined | null) {
  return value?.replace(/\s+/g, '').trim() || undefined
}

async function getEmailConfig() {
  const [email, branding] = await Promise.all([
    getSetting<EmailSettings>('email', {
      notification_to: 'team@yorki.local', reply_to: null,
      subject_prefix: '[Yorki]', notify_on_submit: true,
      notify_on_complete: true, notify_on_comment: false,
    }),
    getSetting<BrandingSettings>('branding', {
      app_name: 'Yorki', logo_url: null,
      primary_color: '222 41% 25%', accent_color: '28 40% 47%',
    }),
  ])
  return { email, branding }
}

function getSmtpConfig() {
  const host = cleanEnvValue(process.env.SMTP_HOST)
  const port = Number(process.env.SMTP_PORT ?? '587')
  const user = cleanEnvValue(process.env.SMTP_USER)
  const pass = cleanEnvValue(process.env.SMTP_PASS)

  if (!host || !user || !pass) {
    return null
  }

  return {
    host,
    port,
    user,
    pass,
    secure: process.env.SMTP_SECURE === 'true',
    requireTLS: process.env.SMTP_REQUIRE_TLS !== 'false',
    from: cleanEnvValue(process.env.EMAIL_FROM) ?? user,
    replyTo: cleanEnvValue(process.env.SMTP_REPLY_TO) ?? cleanEnvValue(process.env.EMAIL_REPLY_TO) ?? undefined,
  }
}

async function getTransporter() {
  if (!transporterPromise) {
    const smtp = getSmtpConfig()
    if (!smtp) {
      throw new Error('SMTP is not configured')
    }

    transporterPromise = Promise.resolve(nodemailer.createTransport({
      host: smtp.host,
      port: smtp.port,
      secure: smtp.secure,
      requireTLS: smtp.requireTLS,
      auth: {
        user: smtp.user,
        pass: smtp.pass,
      },
    }))
  }

  return transporterPromise
}

async function sendEmail(options: {
  to: string | string[]
  subject: string
  html: string
  replyTo?: string
}) {
  const resendApiKey = cleanEnvValue(process.env.RESEND_API_KEY)
  const from = cleanEnvValue(process.env.EMAIL_FROM) ?? cleanEnvValue(process.env.SMTP_USER) ?? 'onboarding@resend.dev'
  const replyTo = cleanEnvValue(options.replyTo) ?? cleanEnvValue(process.env.SMTP_REPLY_TO) ?? cleanEnvValue(process.env.EMAIL_REPLY_TO) ?? undefined

  if (resendApiKey) {
    resendClient ??= new Resend(resendApiKey)
    await resendClient.emails.send({
      from,
      to: Array.isArray(options.to) ? options.to : [options.to],
      reply_to: replyTo,
      subject: options.subject,
      html: options.html,
    })
    return true
  }

  const smtp = getSmtpConfig()
  if (!smtp) {
    return false
  }

  const transporter = await getTransporter()
  await transporter.sendMail({
    from: smtp.from,
    to: options.to,
    replyTo: options.replyTo ?? smtp.replyTo,
    subject: options.subject,
    html: options.html,
  })
  return true
}

export async function sendTaskSubmittedEmail(task: Task, submitter: SessionUser): Promise<void> {
  try {
    const { email: cfg, branding } = await getEmailConfig()
    if (!cfg?.notify_on_submit) return

    const subject = `${cfg.subject_prefix ?? '[Yorki]'} New Request: ${task.title}`
    const sent = await sendEmail({
      to: cfg.notification_to,
      subject,
      html: buildSubmittedHtml({ task, submitter, branding }),
    })
    if (!sent) {
      console.log(`[Email disabled] New request "${task.title}" for ${cfg.notification_to}`)
    }
  } catch (err) {
    console.error('[Email: submitted]', err)
  }
}

export async function sendTaskCompletedEmail(
  task: Task & { submitted_by_profile?: { email?: string; full_name?: string } },
  completedBy: SessionUser
): Promise<void> {
  try {
    const { email: cfg, branding } = await getEmailConfig()
    if (!cfg?.notify_on_complete) return

    const recipients = [cfg.notification_to]
    const submitterEmail = task.submitted_by_profile?.email
    if (submitterEmail && submitterEmail !== cfg.notification_to) recipients.push(submitterEmail)

    const sent = await sendEmail({
      to: recipients,
      subject: `${cfg.subject_prefix ?? '[Yorki]'} Completed: ${task.title}`,
      html: buildCompletedHtml({ task, completedBy, branding }),
    })
    if (!sent) {
      console.log(`[Email disabled] Completed request "${task.title}" for ${recipients.join(', ')}`)
    }
  } catch (err) {
    console.error('[Email: completed]', err)
  }
}

export async function sendTaskSharedEmail({
  task,
  recipientEmail,
  sender,
}: {
  task: Task
  recipientEmail: string
  sender: SessionUser
}): Promise<void> {
  try {
    const { branding } = await getEmailConfig()
    const appUrl = process.env.APP_URL ?? 'http://localhost:3000'
    const shareToken =
      typeof task.custom_fields?.share_token === 'string' ? task.custom_fields.share_token.trim() : ''
    const taskUrl = shareToken
      ? `${appUrl}/request/${encodeURIComponent(shareToken)}`
      : `${appUrl}/dashboard?task=${encodeURIComponent(task.id)}`
    const subject = `${branding?.app_name ?? 'Yorki'} Task Update: ${task.title}`
    const sent = await sendEmail({
      to: recipientEmail,
      subject,
      html: buildSharedTaskHtml({ task, sender, branding, taskUrl }),
    })

    if (!sent) {
      console.log(`\n📧 [Shared task] ${recipientEmail}\n   Title: ${task.title}\n   URL: ${taskUrl}\n`)
    }
  } catch (err) {
    console.error('[Email: shared task]', err)
  }
}

function buildSubmittedHtml({ task, submitter, branding }: { task: Task; submitter: SessionUser; branding: BrandingSettings }): string {
  const appName = branding?.app_name ?? 'Yorki'
  const appUrl  = process.env.APP_URL ?? 'http://localhost:3000'
  const priorityColors: Record<string, string> = { low:'#6b7280', normal:'#3b82f6', high:'#f97316', urgent:'#ef4444' }
  const pc = priorityColors[task.priority] ?? '#3b82f6'
  return `<!DOCTYPE html><html><body style="margin:0;padding:0;font-family:Arial,sans-serif;background:#f4f4f5;">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:32px 16px;"><tr><td>
  <table width="600" align="center" cellpadding="0" cellspacing="0" style="max-width:600px;margin:0 auto;background:#fff;border-radius:12px;">
  <tr><td style="background:#1e293b;padding:24px 32px;">
    <p style="margin:0;color:#94a3b8;font-size:13px;">${appName}</p>
    <h1 style="margin:4px 0 0;color:#f8fafc;font-size:20px;">New Request Submitted</h1>
  </td></tr>
  <tr><td style="padding:32px;">
    <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:20px;margin-bottom:24px;">
      <span style="background:${pc};color:#fff;font-size:11px;padding:2px 8px;border-radius:4px;">${task.priority.toUpperCase()}</span>
      <h2 style="margin:8px 0;color:#0f172a;font-size:18px;">${escapeHtml(task.title)}</h2>
      ${task.description ? `<p style="margin:0;color:#64748b;font-size:14px;">${escapeHtml(task.description)}</p>` : ''}
    </div>
    <p style="color:#475569;">Submitted by: <strong>${escapeHtml(submitter.full_name ?? submitter.email)}</strong></p>
    <a href="${appUrl}/dashboard" style="display:inline-block;background:#1e293b;color:#f8fafc;text-decoration:none;padding:12px 24px;border-radius:8px;font-size:14px;font-weight:600;">View on Board →</a>
  </td></tr>
  <tr><td style="background:#f8fafc;padding:16px 32px;border-top:1px solid #e2e8f0;">
    <p style="margin:0;color:#94a3b8;font-size:12px;">${appName} — Internal Task Management</p>
  </td></tr>
  </table></td></tr></table></body></html>`
}

function buildCompletedHtml({ task, completedBy, branding }: { task: Task; completedBy: SessionUser; branding: BrandingSettings }): string {
  const appName    = branding?.app_name ?? 'Yorki'
  const appUrl     = process.env.APP_URL ?? 'http://localhost:3000'
  const completedAt = task.completed_at ? formatDateTime(task.completed_at) : formatDateTime(new Date().toISOString())
  return `<!DOCTYPE html><html><body style="margin:0;padding:0;font-family:Arial,sans-serif;background:#f4f4f5;">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:32px 16px;"><tr><td>
  <table width="600" align="center" cellpadding="0" cellspacing="0" style="max-width:600px;margin:0 auto;background:#fff;border-radius:12px;">
  <tr><td style="background:#065f46;padding:24px 32px;">
    <p style="margin:0;color:#6ee7b7;font-size:13px;">${appName}</p>
    <h1 style="margin:4px 0 0;color:#ecfdf5;font-size:20px;">✓ Request Completed</h1>
  </td></tr>
  <tr><td style="padding:32px;">
    <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:20px;margin-bottom:24px;">
      <h2 style="margin:0 0 8px;color:#0f172a;font-size:18px;">${escapeHtml(task.title)}</h2>
    </div>
    <p style="color:#475569;">Completed by: <strong>${escapeHtml(completedBy.full_name ?? completedBy.email)}</strong> at ${completedAt}</p>
    <a href="${appUrl}/dashboard" style="display:inline-block;background:#065f46;color:#ecfdf5;text-decoration:none;padding:12px 24px;border-radius:8px;font-size:14px;font-weight:600;">View on Board →</a>
  </td></tr>
  <tr><td style="background:#f8fafc;padding:16px 32px;border-top:1px solid #e2e8f0;">
    <p style="margin:0;color:#94a3b8;font-size:12px;">${appName} — Internal Task Management</p>
  </td></tr>
  </table></td></tr></table></body></html>`
}

function buildSharedTaskHtml({
  task,
  sender,
  branding,
  taskUrl,
}: {
  task: Task
  sender: SessionUser
  branding: BrandingSettings
  taskUrl: string
}): string {
  const appName = branding?.app_name ?? 'Yorki'
  const priorityColors: Record<string, string> = { low: '#8A8F98', normal: '#2F3650', high: '#A6784A', urgent: '#B84C3E' }
  const priorityColor = priorityColors[task.priority] ?? '#2F3650'
  const address = typeof task.custom_fields?.address === 'string' ? task.custom_fields.address : null
  const dueDate = task.due_date ? formatDateTime(task.due_date) : 'Not set'

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head>
<body style="margin:0;padding:0;background:#F6F3EE;font-family:'DM Sans',Arial,sans-serif;color:#2F3650;">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:36px 16px;">
    <tr><td>
      <table width="560" align="center" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:18px;overflow:hidden;box-shadow:0 14px 40px rgba(47,54,80,0.10);border:1px solid #E7DED2;">
        <tr>
          <td style="background:linear-gradient(135deg,#2F3650 0%,#47577A 100%);padding:32px 34px;">
            <p style="margin:0 0 6px;color:#D9E2EE;font-size:12px;letter-spacing:0.12em;text-transform:uppercase;">${appName}</p>
            <h1 style="margin:0;color:#F6F3EE;font-size:24px;font-weight:700;letter-spacing:-0.03em;">A task was shared with you</h1>
          </td>
        </tr>
        <tr>
          <td style="padding:32px 34px;">
            <p style="margin:0 0 18px;font-size:15px;line-height:1.7;color:#4E5F8C;">
              ${escapeHtml(sender.full_name ?? sender.email)} sent you a task update from ${appName}. Use the button below to view the latest details.
            </p>

            <div style="border:1px solid #E7DED2;border-radius:16px;padding:22px 22px 18px;background:#FCFAF7;">
              <div style="margin-bottom:14px;">
                <span style="display:inline-block;background:${priorityColor};color:#ffffff;font-size:11px;font-weight:700;padding:5px 10px;border-radius:999px;text-transform:uppercase;letter-spacing:0.08em;">${task.priority}</span>
              </div>
              <h2 style="margin:0 0 10px;font-size:22px;line-height:1.25;color:#1F2A44;">${escapeHtml(task.title)}</h2>
              ${task.description ? `<p style="margin:0 0 16px;font-size:14px;line-height:1.7;color:#5C6E91;">${escapeHtml(task.description).replace(/\n/g, '<br>')}</p>` : ''}
              <table width="100%" cellpadding="0" cellspacing="0" style="font-size:13px;color:#5C6E91;">
                <tr>
                  <td style="padding:0 0 10px;"><strong style="color:#2F3650;">Status:</strong> ${task.status.replace(/_/g, ' ')}</td>
                  <td style="padding:0 0 10px;"><strong style="color:#2F3650;">Due:</strong> ${dueDate}</td>
                </tr>
                ${address ? `<tr><td colspan="2" style="padding:0;"><strong style="color:#2F3650;">Address:</strong> ${escapeHtml(address).replace(/\n/g, ', ')}</td></tr>` : ''}
              </table>
            </div>

            <div style="text-align:center;margin:28px 0 18px;">
              <a href="${taskUrl}" style="display:inline-block;background:#A6784A;color:#F6F3EE;text-decoration:none;padding:14px 30px;border-radius:12px;font-size:14px;font-weight:700;letter-spacing:0.01em;">Open in Yorki</a>
            </div>

            <p style="margin:0;font-size:12px;line-height:1.7;color:#8896BA;text-align:center;">
              This link opens the task directly inside Yorki.
            </p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`
}

export async function sendInviteEmail(
  to: string,
  fullName: string,
  role: string,
  inviteUrl: string
): Promise<void> {
  try {
    const sent = await sendEmail({
      to,
      subject: `You've been invited to Yorki`,
      html: buildInviteHtml({ fullName, role, inviteUrl, appName: 'Yorki' }),
    })

    if (!sent) {
      console.log(`\n📧 [Invite] ${fullName} <${to}>\n   Role: ${role}\n   URL:  ${inviteUrl}\n`)
      return
    }
  } catch (err) {
    console.error('[Email: invite]', err)
  }
}

function buildInviteHtml({
  fullName, role, inviteUrl, appName,
}: {
  fullName: string; role: string; inviteUrl: string; appName: string
}): string {
  const roleLabel = role === 'admin' ? 'Admin' : 'Staff'
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head>
<body style="margin:0;padding:0;font-family:'DM Sans',Arial,sans-serif;background:#F0F2F7;">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:40px 16px;">
    <tr><td>
      <table width="520" align="center" cellpadding="0" cellspacing="0"
        style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(47,54,80,0.10);">

        <!-- Header -->
        <tr>
          <td style="background:linear-gradient(135deg,#2F3650 0%,#3A4A73 100%);padding:32px;text-align:center;">
            <p style="margin:0 0 4px;color:#8896BA;font-size:11px;letter-spacing:0.1em;text-transform:uppercase;">${appName}</p>
            <h1 style="margin:0;color:#F0F2F7;font-size:22px;font-weight:600;letter-spacing:-0.3px;">You're invited</h1>
          </td>
        </tr>

        <!-- Body -->
        <tr>
          <td style="padding:36px 32px;">
            <p style="margin:0 0 8px;color:#0F1220;font-size:16px;font-weight:600;">Hi ${escapeHtml(fullName)} 👋</p>
            <p style="margin:0 0 24px;color:#4E5F8C;font-size:14px;line-height:1.7;">
              You've been added to <strong>${appName}</strong> as a <strong>${roleLabel}</strong>.
              Click the button below to set your password and access your workspace.
            </p>

            <!-- Role badge -->
            <div style="display:inline-block;background:#EAF2FB;color:#1A64A8;border:1px solid #90BBE8;
              font-size:11px;font-weight:600;padding:4px 12px;border-radius:99px;margin-bottom:28px;
              text-transform:uppercase;letter-spacing:0.08em;">
              ${roleLabel}
            </div>

            <!-- CTA button -->
            <div style="text-align:center;margin:0 0 28px;">
              <a href="${inviteUrl}"
                style="display:inline-block;background:#2F3650;color:#F0F2F7;text-decoration:none;
                  padding:14px 36px;border-radius:10px;font-size:14px;font-weight:600;
                  letter-spacing:0.01em;">
                Set my password →
              </a>
            </div>

            <!-- Expiry note -->
            <p style="margin:0;color:#8896BA;font-size:12px;text-align:center;line-height:1.6;">
              This link expires in 48 hours.<br>
              If you weren't expecting this, you can ignore this email.
            </p>
          </td>
        </tr>

        <!-- Footer -->
        <tr>
          <td style="background:#F0F2F7;padding:16px 32px;border-top:1px solid #D8DCE8;">
            <p style="margin:0;color:#8896BA;font-size:11px;text-align:center;">
              ${appName} · Internal workspace
            </p>
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`
}

export async function sendMentionEmail({ task, recipient, author, snippet }: {
  task: Task
  recipient: { email: string | null; full_name: string | null }
  author: SessionUser
  snippet: string
}): Promise<void> {
  try {
    if (!recipient.email) return
    const { email: cfg, branding } = await getEmailConfig()
    if (cfg?.notify_on_mention === false) return

    const appName = branding?.app_name ?? 'Yorki'
    const appUrl = (process.env.APP_URL ?? 'http://localhost:3000').replace(/\/$/, '')
    const taskUrl = `${appUrl}/dashboard?task=${encodeURIComponent(task.id)}`
    const authorName = author.full_name ?? author.email
    const sent = await sendEmail({
      to: recipient.email,
      subject: `${cfg?.subject_prefix ?? '[Yorki]'} ${authorName} mentioned you: ${task.title}`,
      html: `<!DOCTYPE html><html><body style="margin:0;padding:0;font-family:Arial,sans-serif;background:#f4f4f5;">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:32px 16px;"><tr><td>
  <table width="600" align="center" cellpadding="0" cellspacing="0" style="max-width:600px;margin:0 auto;background:#fff;border-radius:12px;">
  <tr><td style="background:#1e293b;padding:24px 32px;">
    <p style="margin:0;color:#94a3b8;font-size:13px;">${escapeHtml(appName)}</p>
    <h1 style="margin:4px 0 0;color:#f8fafc;font-size:20px;">${escapeHtml(authorName)} mentioned you</h1>
  </td></tr>
  <tr><td style="padding:32px;">
    <p style="margin:0 0 8px;color:#475569;font-size:13px;">On <strong>${escapeHtml(task.title)}</strong></p>
    <div style="background:#f8fafc;border-left:3px solid #6A97C4;border-radius:6px;padding:14px 16px;margin-bottom:24px;color:#0f172a;font-size:14px;white-space:pre-wrap;">${escapeHtml(snippet)}</div>
    <a href="${escapeHtml(taskUrl)}" style="display:inline-block;background:#1e293b;color:#f8fafc;text-decoration:none;padding:12px 24px;border-radius:8px;font-size:14px;font-weight:600;">Open the card →</a>
  </td></tr>
  </table></td></tr></table></body></html>`,
    })
    if (!sent) console.log(`[Email disabled] Mention for ${recipient.email} on "${task.title}"`)
  } catch (err) {
    console.error('[Email: mention]', err)
  }
}
