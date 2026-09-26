# Media storage setup

The application uses this split by design:

- **Cloudinary**: `image/*` uploads such as avatars, course covers, and payment proof images.
- **Cloudflare R2**: videos, PDFs, homework attachments, and other files. Video upload goes directly from the browser to R2, so a 200MB file does not occupy API server memory.

## 1. Cloudinary (free plan is suitable for initial images)

In the Cloudinary Console, create a product environment and copy **Cloud name**, **API Key**, and **API Secret** from API Keys. Put them only in `Backend/.env`:

```env
CLOUDINARY_ENABLED=true
CLOUDINARY_CLOUD_NAME=...
CLOUDINARY_API_KEY=...
CLOUDINARY_API_SECRET=...
CLOUDINARY_FOLDER=elearning
```

Do not expose `CLOUDINARY_API_SECRET` to the frontend and do not commit `.env`.

### Local disk fallback

Set `CLOUDINARY_FALLBACK_TO_LOCAL=true` to save an image under `Backend/uploads/` only when Cloudinary rejects it because the quota is exhausted. The folder belongs to the machine running the backend—not the teacher's personal device unless the backend itself runs on that device. Set `STORAGE_BASE_URL` to the public HTTPS API address in deployment.

This is a temporary safety net. It needs persistent server storage, disk-space alerts, and backups. It is not suitable for multiple API servers because each server has a different disk.

## 2. Cloudflare R2 (video and documents)

1. Create an R2 bucket, for example `elearning-media`.
2. Create an API token with **Object Read & Write** permission scoped to that bucket. Copy its Access Key ID and Secret Access Key.
3. Copy the S3 API endpoint in the R2 dashboard. It has this shape: `https://<account-id>.r2.cloudflarestorage.com`.
4. Set the following values in `Backend/.env` and restart the API:

```env
STORAGE_DRIVER=s3
AWS_REGION=auto
AWS_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...
AWS_S3_BUCKET=elearning-media
AWS_S3_PUBLIC_URL=https://<account-id>.r2.cloudflarestorage.com/elearning-media
```

Keep the bucket private. The backend returns short-lived signed URLs to students after it checks enrollment. Do not use a public custom domain for protected lessons.

## 3. Required R2 CORS rule

Direct browser video uploads need a CORS rule on the bucket. In the R2 bucket CORS settings, add your exact frontend origins and allow `PUT`:

```json
[
  {
    "AllowedOrigins": ["http://localhost:5173", "https://app.example.com"],
    "AllowedMethods": ["PUT"],
    "AllowedHeaders": ["Content-Type"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3600
  }
]
```

Replace `https://app.example.com` with the deployed frontend address and remove origins you do not use. The presigned URL expires after 30 minutes; it does not reveal R2 credentials.
