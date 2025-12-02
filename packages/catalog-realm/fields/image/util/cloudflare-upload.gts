import SendRequestViaProxyCommand from '@cardstack/boxel-host/commands/send-request-via-proxy';

const DIRECT_UPLOAD_URL =
  'https://api.cloudflare.com/client/v4/accounts/4a94a1eb2d21bbbe160234438a49f687/images/v2/direct_upload';

export async function requestCloudflareUploadUrl(
  commandContext: any,
  metadata: Record<string, string> = {},
): Promise<string> {
  if (!commandContext) {
    throw new Error('Missing command context for proxy request');
  }

  const sendRequestViaProxyCommand = new SendRequestViaProxyCommand(
    commandContext,
  );

  const result = await sendRequestViaProxyCommand.execute({
    url: DIRECT_UPLOAD_URL,
    method: 'POST',
    multipart: true,
    requestBody: JSON.stringify({
      id: `upload-${Date.now()}`,
      requireSignedURLs: 'false',
      metadata: JSON.stringify({
        source: metadata.source || 'boxel-image-field',
        timestamp: new Date().toISOString(),
      }),
    }),
  });

  if (!result.response.ok) {
    throw new Error(await formatCloudflareError(result.response));
  }

  const data = await result.response.json();
  if (data.success && data.result?.uploadURL) {
    return data.result.uploadURL;
  }

  throw new Error('Failed to get upload URL from response');
}

export async function uploadFileToCloudflare(
  uploadUrl: string,
  file: File,
): Promise<string> {
  const formData = new FormData();
  formData.append('file', file);

  const response = await fetch(uploadUrl, {
    method: 'POST',
    body: formData,
  });

  if (!response.ok) {
    throw new Error(await formatUploadFailure(response));
  }

  const result = await response.json();
  const imageUrl = result.result?.variants?.[0] || result.result?.id;
  if (!imageUrl) {
    throw new Error('Upload succeeded but no image URL returned');
  }
  return imageUrl;
}

async function formatUploadFailure(response: Response): Promise<string> {
  let body = '';
  try {
    body = await response.text();
  } catch {
    body = '[Could not read response body]';
  }
  return `Upload failed: ${response.status} ${response.statusText}\n\n${body}`;
}

async function formatCloudflareError(response: Response): Promise<string> {
  let errorBody = '';

  try {
    const errorText = await response.text();
    try {
      const errorJson = JSON.parse(errorText);
      if (errorJson.errors && Array.isArray(errorJson.errors)) {
        const cloudflareErrors = errorJson.errors
          .map((err: any) => `Code ${err.code}: ${err.message}`)
          .join('\n');
        errorBody = `Cloudflare API Errors:\n${cloudflareErrors}`;
      } else {
        errorBody = JSON.stringify(errorJson, null, 2);
      }
    } catch {
      errorBody = errorText;
    }
  } catch {
    errorBody = '[Could not read response body]';
  }

  return `Cloudflare API Error (${response.status})\n\n${errorBody}`;
}
