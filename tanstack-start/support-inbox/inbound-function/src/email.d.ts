// Types for the helpers the site shares with the inbound function, so a message
// that arrives over HTTP is threaded and stored exactly like an email.
export declare const REF_PATTERN: RegExp
export declare function hashId(prefix: string, value: string): string
export declare function decodeWords(value: unknown): string
export declare function parseAddress(value: unknown): { name: string; email: string }
export declare function sameAddress(a: string, b: string): boolean
export declare function plusTag(address: unknown): string
export declare function stripTag(address: unknown): string
export declare function subjectRef(subject: unknown): string
export declare function cleanSubject(subject: unknown): string
export declare function extractMessageIds(values: unknown[]): string[]
export declare function normalizeMessageId(id: unknown): string
export declare function htmlToText(html: unknown): string
export declare function previewOf(text: unknown, html: unknown): string
export declare function safeFileName(name: unknown): string
