function clickDownload(url: string, filename: string) {
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
}

export async function downloadInfographicAsPng(input: {
  artifactUrl: string;
  filename: string;
}): Promise<'png' | 'svg-fallback'> {
  const fallback = () => {
    clickDownload(input.artifactUrl, `${input.filename}.svg`);
    return 'svg-fallback' as const;
  };

  let sourceUrl: string | null = null;
  let pngUrl: string | null = null;
  try {
    const response = await fetch(input.artifactUrl);
    if (!response.ok) return fallback();
    sourceUrl = URL.createObjectURL(await response.blob());
    const image = new Image();
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error('Unable to load infographic SVG'));
      image.src = sourceUrl as string;
    });
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth || image.width;
    canvas.height = image.naturalHeight || image.height;
    if (!canvas.width || !canvas.height) return fallback();
    canvas.getContext('2d')?.drawImage(image, 0, 0);
    const png = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!png) return fallback();
    pngUrl = URL.createObjectURL(png);
    clickDownload(pngUrl, `${input.filename}.png`);
    return 'png';
  } catch {
    return fallback();
  } finally {
    if (sourceUrl) URL.revokeObjectURL(sourceUrl);
    if (pngUrl) URL.revokeObjectURL(pngUrl);
  }
}
