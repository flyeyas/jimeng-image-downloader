const pendingDownloadFilenames = new Map();

chrome.downloads.onDeterminingFilename.addListener((downloadItem, suggest) => {
  const pendingFilename = pendingDownloadFilenames.get(downloadItem.id);
  if (!pendingFilename) {
    return;
  }

  pendingDownloadFilenames.delete(downloadItem.id);
  suggest({
    filename: pendingFilename,
    conflictAction: "uniquify"
  });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== "download-single-image") {
    return false;
  }

  const url = typeof message.url === "string" ? message.url.trim() : "";
  const pageTitle = typeof message.pageTitle === "string" ? message.pageTitle : "";
  if (!url) {
    sendResponse({ ok: false, error: "No image URL found." });
    return false;
  }

  downloadAsExtensionFile(url, pageTitle)
    .then((downloadId) => {
      sendResponse({ ok: true, downloadId });
    })
    .catch((error) => {
      sendResponse({ ok: false, error: error.message });
    });

  return true;
});

async function downloadAsExtensionFile(url, pageTitle) {
  const response = await fetch(url, {
    credentials: "omit"
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  const sourceBlob = await response.blob();
  const jpegBlob = await convertBlobToJpeg(sourceBlob);
  const dataUrl = await blobToDataUrl(jpegBlob);
  const fileHash = await md5FromBlob(jpegBlob);
  const filename = buildFilename(pageTitle, fileHash);

  return new Promise((resolve, reject) => {
    chrome.downloads.download(
      {
        url: dataUrl,
        filename,
        saveAs: false,
        conflictAction: "uniquify"
      },
      (downloadId) => {
        const runtimeError = chrome.runtime.lastError;
        if (runtimeError) {
          reject(new Error(runtimeError.message));
          return;
        }

        pendingDownloadFilenames.set(downloadId, filename);

        resolve(downloadId);
      }
    );
  });
}

async function convertBlobToJpeg(blob) {
  const imageBitmap = await createImageBitmap(blob);
  const canvas = new OffscreenCanvas(imageBitmap.width, imageBitmap.height);
  const context = canvas.getContext("2d", { alpha: false });

  if (!context) {
    imageBitmap.close();
    throw new Error("Canvas context unavailable.");
  }

  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(imageBitmap, 0, 0);
  imageBitmap.close();

  return canvas.convertToBlob({
    type: "image/jpeg",
    quality: 0.92
  });
}

async function blobToDataUrl(blob) {
  const buffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunkSize = 0x8000;

  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }

  const mimeType = blob.type || "application/octet-stream";
  return `data:${mimeType};base64,${btoa(binary)}`;
}

function buildFilename(pageTitle = "", fileHash = "") {
  const folderName = sanitizePathSegment(pageTitle) || "jimeng-image";
  const baseName = fileHash || `image-${Date.now()}`;
  return `${folderName}/${baseName}.jpg`;
}

function sanitizePathSegment(input) {
  return input
    .replace(/[\\/:*?"<>|]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
}

async function md5FromBlob(blob) {
  const buffer = await blob.arrayBuffer();
  return md5Hex(new Uint8Array(buffer));
}

function md5Hex(inputBytes) {
  const bytes = new Uint8Array((((inputBytes.length + 8) >> 6) + 1) * 64);
  bytes.set(inputBytes);
  bytes[inputBytes.length] = 0x80;

  const bitLength = inputBytes.length * 8;
  const view = new DataView(bytes.buffer);
  view.setUint32(bytes.length - 8, bitLength >>> 0, true);
  view.setUint32(bytes.length - 4, Math.floor(bitLength / 0x100000000), true);

  let a = 0x67452301;
  let b = 0xefcdab89;
  let c = 0x98badcfe;
  let d = 0x10325476;

  const k = [
    0xd76aa478, 0xe8c7b756, 0x242070db, 0xc1bdceee,
    0xf57c0faf, 0x4787c62a, 0xa8304613, 0xfd469501,
    0x698098d8, 0x8b44f7af, 0xffff5bb1, 0x895cd7be,
    0x6b901122, 0xfd987193, 0xa679438e, 0x49b40821,
    0xf61e2562, 0xc040b340, 0x265e5a51, 0xe9b6c7aa,
    0xd62f105d, 0x02441453, 0xd8a1e681, 0xe7d3fbc8,
    0x21e1cde6, 0xc33707d6, 0xf4d50d87, 0x455a14ed,
    0xa9e3e905, 0xfcefa3f8, 0x676f02d9, 0x8d2a4c8a,
    0xfffa3942, 0x8771f681, 0x6d9d6122, 0xfde5380c,
    0xa4beea44, 0x4bdecfa9, 0xf6bb4b60, 0xbebfbc70,
    0x289b7ec6, 0xeaa127fa, 0xd4ef3085, 0x04881d05,
    0xd9d4d039, 0xe6db99e5, 0x1fa27cf8, 0xc4ac5665,
    0xf4292244, 0x432aff97, 0xab9423a7, 0xfc93a039,
    0x655b59c3, 0x8f0ccc92, 0xffeff47d, 0x85845dd1,
    0x6fa87e4f, 0xfe2ce6e0, 0xa3014314, 0x4e0811a1,
    0xf7537e82, 0xbd3af235, 0x2ad7d2bb, 0xeb86d391
  ];
  const s = [
    7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
    5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
    4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
    6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21
  ];

  for (let offset = 0; offset < bytes.length; offset += 64) {
    const words = new Array(16);
    for (let i = 0; i < 16; i += 1) {
      words[i] = view.getUint32(offset + i * 4, true);
    }

    let aa = a;
    let bb = b;
    let cc = c;
    let dd = d;

    for (let i = 0; i < 64; i += 1) {
      let f;
      let g;

      if (i < 16) {
        f = (bb & cc) | (~bb & dd);
        g = i;
      } else if (i < 32) {
        f = (dd & bb) | (~dd & cc);
        g = (5 * i + 1) % 16;
      } else if (i < 48) {
        f = bb ^ cc ^ dd;
        g = (3 * i + 5) % 16;
      } else {
        f = cc ^ (bb | ~dd);
        g = (7 * i) % 16;
      }

      const temp = dd;
      dd = cc;
      cc = bb;
      bb = add32(
        bb,
        leftRotate(add32(add32(add32(aa, f), k[i]), words[g]), s[i])
      );
      aa = temp;
    }

    a = add32(a, aa);
    b = add32(b, bb);
    c = add32(c, cc);
    d = add32(d, dd);
  }

  return [a, b, c, d].map(toLittleEndianHex).join("");
}

function leftRotate(value, shift) {
  return (value << shift) | (value >>> (32 - shift));
}

function add32(x, y) {
  return (x + y) >>> 0;
}

function toLittleEndianHex(value) {
  const hex = [];
  for (let i = 0; i < 4; i += 1) {
    hex.push(((value >>> (i * 8)) & 0xff).toString(16).padStart(2, "0"));
  }
  return hex.join("");
}
