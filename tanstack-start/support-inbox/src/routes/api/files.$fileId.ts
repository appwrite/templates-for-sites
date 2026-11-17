import { createFileRoute } from '@tanstack/react-router'
import { AppwriteException } from 'node-appwrite'
import { BUCKET_ID, admin, currentAgent } from '#/server/appwrite.server'

// Raster images and PDFs may render inline (for cid: images in email HTML).
// Everything else, SVG and HTML included, is forced to download.
const INLINE_TYPES = /^(image\/(png|jpe?g|gif|webp|avif|bmp)|application\/pdf)$/i

export const Route = createFileRoute('/api/files/$fileId')({
  server: {
    handlers: {
      GET: async ({ params, request }) => {
        if (!(await currentAgent())) return new Response('Unauthorized', { status: 401 })

        const { storage } = admin()
        try {
          const file = await storage.getFile({ bucketId: BUCKET_ID, fileId: params.fileId })
          const data = await storage.getFileDownload({ bucketId: BUCKET_ID, fileId: params.fileId })
          const inline = new URL(request.url).searchParams.get('inline') === '1' && INLINE_TYPES.test(file.mimeType)

          return new Response(data, {
            headers: {
              'content-type': inline ? file.mimeType : 'application/octet-stream',
              'content-disposition': `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(file.name)}`,
              // Browsers refuse to open their PDF viewer under a sandbox CSP.
              ...(inline && file.mimeType === 'application/pdf' ? {} : { 'content-security-policy': "sandbox; default-src 'none'" }),
              'x-content-type-options': 'nosniff',
              'cache-control': 'private, max-age=3600',
            },
          })
        } catch (error) {
          if (error instanceof AppwriteException && error.code === 404) return new Response('Not found', { status: 404 })
          throw error
        }
      },
    },
  },
})
