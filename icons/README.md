# Extension Icons

Place your extension icons in this directory with the following sizes:

- `icon-16.png` - 16x16 pixels (for browser UI)
- `icon-32.png` - 32x32 pixels (for Windows computers)
- `icon-48.png` - 48x48 pixels (for extensions page)
- `icon-128.png` - 128x128 pixels (for Chrome Web Store)

## Icon Design Guidelines

1. Use a clear, simple design that represents file uploading
2. Ensure good visibility on both light and dark backgrounds
3. Use consistent colors with GitHub's brand (optional)
4. Make sure icons are sharp and not pixelated

## Creating Icons

You can create icons using any image editor. Here are some suggestions:

### Using an online tool:
1. Visit [Favicon.io](https://favicon.io/) or similar services
2. Design or upload your base icon
3. Download the generated icon pack
4. Rename files according to the requirements above

### Using command-line (ImageMagick):
```bash
# If you have a high-resolution source image (icon-source.png):
convert icon-source.png -resize 16x16 icon-16.png
convert icon-source.png -resize 32x32 icon-32.png
convert icon-source.png -resize 48x48 icon-48.png
convert icon-source.png -resize 128x128 icon-128.png
```

## Placeholder SVG Icon

For testing, you can use this SVG as a base:

```svg
<svg width="128" height="128" viewBox="0 0 128 128" xmlns="http://www.w3.org/2000/svg">
  <rect width="128" height="128" rx="20" fill="#0366d6"/>
  <path d="M64 32 L80 48 L72 48 L72 80 L56 80 L56 48 L48 48 Z" fill="white"/>
  <rect x="40" y="88" width="48" height="8" rx="2" fill="white"/>
</svg>
```

Save this SVG and convert it to PNG format for use as extension icons.
