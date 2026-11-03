import { plainTextToHtml } from "./plain-text";

// The font an email client would fall back to. The Text tab uses it too, so both read the same.
export const EMAIL_FONT_STACK =
	'-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';

// Applied to plain HTML only, such as a Gmail or Apple Mail reply. It sits in a cascade layer,
// so every rule the email sets itself, in a <style> block or inline, still wins.
export const READING_CSS = `@layer catchall{
:root{color-scheme:light}
body{margin:0;padding:24px 28px 32px;max-width:720px;background:#fff;color:#1f1f1f;font-family:${EMAIL_FONT_STACK};font-size:15px;line-height:1.6;overflow-wrap:break-word;-webkit-text-size-adjust:100%}
a:link,a:visited{color:#1a5fd0}
img{max-width:100%;height:auto}
p{margin:0 0 1em}
blockquote{margin:0 0 1em;padding-left:12px;border-left:2px solid #dcdcdc;color:#5c5c5c}
pre,code{font-family:ui-monospace,"SF Mono",Menlo,monospace;font-size:13px}
pre{white-space:pre-wrap}
hr{border:0;border-top:1px solid #e3e3e3}
.gmail_signature,.gmail_signature_prefix,.catchall-signature{color:#6b6b6b}
.catchall-text{white-space:pre-wrap}
.catchall-signature p:first-child{margin-bottom:.25em}
}`;

// A designed email brings its own layout and type. It renders exactly as before: no reading styles.
export function isDesignedHtml(html: string) {
	for (const [, css] of html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)) {
		const rules = css.replace(/\/\*[\s\S]*?\*\//g, "");
		// Outlook adds a one-line <style> to plain replies. Real layouts set type, colour or width.
		if (
			rules.length > 300 ||
			/@media|font-family|background|(?:^|[\s;{])(?:max-)?width\s*:/i.test(
				rules,
			)
		)
			return true;
	}
	if (/<table\b[^>]*\brole\s*=\s*["']?presentation/i.test(html)) return true;
	if (
		/<table\b[^>]*\bwidth\s*=\s*["']?\s*(?:100%|[4-9]\d\d\b|\d{4,})/i.test(html)
	)
		return true;
	if (/\bbgcolor\s*=/i.test(html)) return true;
	if (
		/<(?:body|center)\b[^>]*\bstyle\s*=\s*["'][^"']*(?:background|font-family)/i.test(
			html,
		)
	)
		return true;
	return false;
}

const HEAD = '<!doctype html><meta charset="utf-8"><base target="_blank">';

// The document for the sandboxed frame (frame: true) or the open-in-a-new-tab preview.
export function previewDocument(html: string, { frame }: { frame: boolean }) {
	if (isDesignedHtml(html))
		return frame ? `${HEAD}<style>body{margin:0}</style>${html}` : HEAD + html;
	return `${HEAD}<style>${READING_CSS}</style>${html}`;
}

// A message with no HTML part, set the same way the Text tab sets it.
export function textPreviewDocument(text: string) {
	return `${HEAD}<style>${READING_CSS}</style>${plainTextToHtml(text)}`;
}
