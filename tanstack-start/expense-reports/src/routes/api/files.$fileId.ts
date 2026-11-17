import { createFileRoute } from '@tanstack/react-router'
import { AppwriteException, Query } from 'node-appwrite'
import { BUCKET_ID, DATABASE_ID, TABLES, admin, currentMember } from '#/server/appwrite.server'

// Raster images and PDFs may render inline; everything else downloads.
const INLINE_TYPES = /^(image\/(png|jpe?g|gif|webp|avif|bmp)|application\/pdf)$/i

export const Route = createFileRoute('/api/files/$fileId')({
  server: {
    handlers: {
      GET: async ({ params, request }) => {
        const member = await currentMember()
        if (!member) return new Response('Unauthorized', { status: 401 })

        const { db, storage } = admin()
        // A receipt is visible to whoever can see the expense it belongs to.
        const { rows } = await db.listRows({
          databaseId: DATABASE_ID,
          tableId: TABLES.expenses,
          queries: [Query.equal('receiptFileId', params.fileId), Query.select(['ownerId']), Query.limit(1)],
          total: false,
        })
        const owner = rows[0]?.ownerId
        if (!owner || (owner !== member.viewer.id && !member.viewer.canApprove)) return new Response('Not found', { status: 404 })

        try {
          const file = await storage.getFile({ bucketId: BUCKET_ID, fileId: params.fileId })
          const data = await storage.getFileDownload({ bucketId: BUCKET_ID, fileId: params.fileId })
          const inline = new URL(request.url).searchParams.get('inline') === '1' && INLINE_TYPES.test(file.mimeType)
          const headers: Record<string, string> = {
            'content-type': inline ? file.mimeType : 'application/octet-stream',
            'content-disposition': `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(file.name)}`,
            'x-content-type-options': 'nosniff',
            'cache-control': 'private, max-age=3600',
          }
          // Browsers refuse to run their PDF viewer under a sandbox CSP.
          if (!(inline && file.mimeType === 'application/pdf')) headers['content-security-policy'] = "sandbox; default-src 'none'"
          return new Response(data, { headers })
        } catch (error) {
          if (error instanceof AppwriteException && error.code === 404) return new Response('Not found', { status: 404 })
          throw error
        }
      },
    },
  },
})
