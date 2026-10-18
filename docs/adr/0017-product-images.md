# ADR 0017 — Product images in object storage

- **Status:** Accepted (2026-10-17)

## Context

Shops want photos on products so staff recognise items at the till and on the price check,
especially where many variants look alike (lipstick shades, sarees). Photos come from phone
cameras: large files with EXIF data, sometimes including the GPS position of the shop or the
owner's home. Files must stay private to the business. Tills cache the catalogue for offline
selling, and photos should keep showing there.

## Decision

### Storage

- Files live in an **S3-compatible bucket** (AWS S3, Cloudflare R2, ...). Locally and in CI
  this is SeaweedFS from `infra/docker-compose.yml`, because MinIO no longer publishes
  pullable images.
- The bucket is **private**: nothing is publicly readable.
- Configuration is `S3_BUCKET`, `S3_ENDPOINT`, `S3_REGION`, `S3_ACCESS_KEY_ID`,
  `S3_SECRET_ACCESS_KEY` and `S3_FORCE_PATH_STYLE`. Without keys, the SDK's default credential
  chain applies (for example an instance role).
- If `S3_BUCKET` is not set, uploads answer `503 STORAGE_UNAVAILABLE`. Nothing pretends to
  succeed.
- Object keys are derived from tenant and image ids: `tenants/<tenantId>/images/<imageId>/{full|thumb}.webp`.
  They are never taken from a request.

### Upload and processing

- **Endpoints:**
  - `POST /products/:id/images` takes multipart data with one `file` field;
  - `PUT /products/:id/images/order` sets the order (the first image is the main one);
  - `DELETE /products/:id/images/:imageId` removes an image.
- All three require `products.manage`.
- **Limits:**
  - files are held in memory, never on the API's disk, up to `PRODUCT_IMAGE_MAX_BYTES`
    (default 5 MB);
  - at most 8 images per product (`IMAGE_LIMIT_REACHED`).
- **Validation:**
  - only JPEG, PNG and WebP are accepted, recognised by their file signature and confirmed by
    the decoder (no SVG, which can carry scripts);
  - images over 50 megapixels or under 64 px on a side are refused.
- **Processing:**
  - every image is **re-encoded** with sharp to WebP at 1600 px and 400 px (longest side);
  - the camera's rotation is applied, and re-encoding drops EXIF/GPS and anything else hidden
    in the file.
- **Saving:**
  - files are written under a fresh id, then the row is recorded in a transaction that locks
    the product;
  - if recording fails, the files are deleted again;
  - the same file uploaded twice (unique `sha256` per product) is kept once, so double taps
    and retries are harmless.
- **Removal:** the row is deleted first, then the files after the commit. A failed delete
  can leave an unreferenced file, but never a row without a file.
- **Sync and audit:**
  - image changes bump the product's `updated_at` (not its `version`), so tills pick them up
    in the next catalogue sync without conflicting with edits to the product's details;
  - changes are audited as `product.image_added`, `product.image_removed` and
    `product.images_reordered`.
- `product_images` has RLS like every tenant table.

### Serving: signed links that redirect

- Product responses carry `images[]` with `url` and `thumbUrl`. Catalogue sync items carry
  `imageUrl` (the main image's thumbnail).
- The links point at the API: `/api/v1/media/t/<tenantId>/i/<imageId>/<size>.webp?s=<sig>`.
- `sig` is an HMAC over the tenant, image and size. Its key is derived with HKDF from
  `JWT_ACCESS_SECRET` under a label used only for media links.
- **Opening a link:**
  1. The API checks the signature in constant time. This is local only, with no database
     or storage call.
  2. It answers `302` to a presigned URL of the private bucket.
  3. The presigned URL's signing time is rounded to the hour, so it repeats within the hour
     and stays valid for at least an hour.
  4. The redirect itself may be cached for 30 minutes.
  5. A link with a bad or missing signature, or one pointed at another tenant, image or
     size, gets a plain `404`.
- **Why signed links rather than authenticated requests:**
  - `<img>` tags and the Android image cache cannot send the bearer token;
  - signed links are stable, so browsers and devices cache photos and tills show them
    offline once seen.
- **Trade-off:** a link works for anyone who has it until the image is deleted or the
  secret is rotated, which also re-keys the links. We accept this for product photos, which
  are shop marketing material rather than personal data.
- `API_PUBLIC_URL` must be the API's public origin, because links are absolute so that the
  Android app can use them.

### Apps

- **Web:**
  - the product page has a Photos card where managers add (several at once), make main and
    remove photos; others see the photos read-only;
  - the product list and the item picker (checkout, stock documents) show thumbnails, with
    an icon when there is no photo or it cannot load.
- **Android:** the price check shows the main photo. Tills store the thumbnail link with
  the offline catalogue.

## Consequences

- One more service to run and back up: bucket versioning and lifecycle rules are set with
  the provider's tooling (Slice 14 covers backup and restore drills).
- No orphan sweeper yet. A failed delete after a commit leaves an unreferenced file, which
  is logged with its key. A periodic listing-versus-rows sweep can be added if logs show
  orphans in practice.
- Taking photos from the Android app is not included. Managers upload from the web app,
  including from a phone browser, which offers the camera for file inputs.
- Image processing uses CPU on the API. Uploads are bounded in size and pixels and
  processed one file per request. With many API replicas, processing can move to a worker
  without changing the API contract.
