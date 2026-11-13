import { v2 as cloudinary } from 'cloudinary';
import { existsSync } from 'node:fs';

const imagePath = process.argv[2];

if (!imagePath || !existsSync(imagePath)) {
  console.error('Usage: node upload-kurtis-profile.mjs <path-to-image>');
  process.exit(1);
}

const { CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET } = process.env;
const cloudName = process.env.CLOUDINARY_CLOUD_NAME || 'dl2xijhcd';

if (!CLOUDINARY_API_KEY || !CLOUDINARY_API_SECRET) {
  console.error('Set CLOUDINARY_API_KEY and CLOUDINARY_API_SECRET environment variables first.');
  process.exit(1);
}

cloudinary.config({
  cloud_name: cloudName,
  api_key: CLOUDINARY_API_KEY,
  api_secret: CLOUDINARY_API_SECRET,
  secure: true
});

try {
  const result = await cloudinary.uploader.upload(imagePath, {
    public_id: 'aurora/profiles/{username}',
    overwrite: true,
    invalidate: true,
    resource_type: 'image'
  });
  console.log('Uploaded:', result.public_id);
  console.log('URL:', result.secure_url);
} catch (err) {
  console.error('Upload failed:', err.message || err);
  process.exit(1);
}
