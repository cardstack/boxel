export default async function downloadAsFileInBrowser(
  blob: Blob,
  name: string,
) {
  // Create a URL for the blob
  const blobUrl = URL.createObjectURL(blob);

  // Create a temporary link element
  const downloadLink = document.createElement('a');
  downloadLink.href = blobUrl;
  downloadLink.download = name;

  // Append the link to the body, click it, and remove it
  document.body.appendChild(downloadLink);
  downloadLink.click();
  document.body.removeChild(downloadLink);

  // Clean up the blob URL
  URL.revokeObjectURL(blobUrl);
}
