import { MAX_IMAGE_BYTES, prepareTaskImage } from "../src/utils/imageCompression";

const results: string[] = [];
function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
function encode(canvas: HTMLCanvasElement, type = "image/jpeg", quality = 0.95): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("encode failed")), type, quality));
}
async function decode(file: Blob) {
  return createImageBitmap(file, { imageOrientation: "from-image" });
}
async function test(name: string, run: () => Promise<void>) {
  try { await run(); results.push(`PASS ${name}`); }
  catch (error) { results.push(`FAIL ${name}: ${error}`); }
  document.querySelector("#results")!.textContent = results.join("\n");
}
const canvas = document.createElement("canvas");
canvas.width = 4000; canvas.height = 3000;
const ctx = canvas.getContext("2d")!;
const pixels = ctx.createImageData(canvas.width, canvas.height);
let seed = 42;
for (let index = 0; index < pixels.data.length; index += 4) {
  seed = (Math.imul(seed, 1664525) + 1013904223) | 0;
  pixels.data[index] = seed & 255;
  pixels.data[index + 1] = (seed >>> 8) & 255;
  pixels.data[index + 2] = (seed >>> 16) & 255;
  pixels.data[index + 3] = 255;
}
ctx.putImageData(pixels, 0, 0);
await test("12MP high-detail photo stays within 1MB and preserves aspect ratio", async () => {
  const input = new File([await encode(canvas)], "camera.jpeg", { type: "image/jpeg" });
  check(input.size > MAX_IMAGE_BYTES, "fixture must exceed 1MB");
  const output = await prepareTaskImage(input);
  check(output.size > 0 && output.size <= MAX_IMAGE_BYTES, "output size");
  check(output.type === "image/jpeg" && output.name === "camera.jpg", "MIME/filename");
  const bitmap = await decode(output);
  check(bitmap.width <= 1920 && Math.abs(bitmap.width / bitmap.height - 4 / 3) < 0.01, "dimensions/aspect");
  results.push(`INFO ${Math.round(input.size / 1024)} KB → ${Math.round(output.size / 1024)} KB (${bitmap.width}×${bitmap.height})`);
  bitmap.close();
});

canvas.width = 320; canvas.height = 160;
ctx.fillStyle = "red"; ctx.fillRect(0, 0, 160, 160);
ctx.fillStyle = "blue"; ctx.fillRect(160, 0, 160, 160);
const small = new File([await encode(canvas)], "small.jpg", { type: "image/jpeg" });
await test("small photo is returned unchanged", async () => check(await prepareTaskImage(small) === small, "small file re-encoded"));
await test("EXIF orientation 6 is preserved after compression", async () => {
  // APP1 Exif, little-endian TIFF with Orientation=6 (90° clockwise).
  const exif = new Uint8Array([0xff,0xe1,0,34,69,120,105,102,0,0,73,73,42,0,8,0,0,0,1,0,18,1,3,0,1,0,0,0,6,0,0,0,0,0,0,0]);
  const bytes = new Uint8Array(await small.arrayBuffer());
  const input = new File([bytes.slice(0, 2), exif, bytes.slice(2), new Uint8Array(MAX_IMAGE_BYTES)], "portrait.jpg", { type: "image/jpeg" });
  const output = await prepareTaskImage(input);
  const bitmap = await decode(output);
  check(bitmap.width === 160 && bitmap.height === 320, "portrait dimensions/orientation");
  const sample = document.createElement("canvas"); sample.width = 160; sample.height = 320;
  const c = sample.getContext("2d")!; c.drawImage(bitmap, 0, 0);
  const top = c.getImageData(80, 30, 1, 1).data;
  check(top[0] > 200 && top[2] < 40, "portrait rotated incorrectly");
  bitmap.close();
});
await test("transparent PNG becomes JPEG on a white background", async () => {
  ctx.clearRect(0, 0, 320, 160); ctx.fillStyle = "black"; ctx.font = "24px sans-serif"; ctx.fillText("文字清晰度 123", 30, 80);
  const input = new File([await encode(canvas, "image/png"), new Uint8Array(MAX_IMAGE_BYTES)], "note.png", { type: "image/png" });
  const output = await prepareTaskImage(input);
  const bitmap = await decode(output); ctx.clearRect(0, 0, 320, 160); ctx.drawImage(bitmap, 0, 0);
  const corner = ctx.getImageData(0, 0, 1, 1).data;
  check(corner[0] > 245 && corner[1] > 245 && corner[2] > 245, "background is not white");
  check(output.size <= MAX_IMAGE_BYTES && output.name === "note.jpg", "PNG output"); bitmap.close();
});
await test("invalid large image gives a readable error", async () => {
  let message = "";
  try { await prepareTaskImage(new File([new Uint8Array(MAX_IMAGE_BYTES + 1)], "broken.jpg", { type: "image/jpeg" })); }
  catch (error) { message = (error as Error).message; }
  check(message.includes("无法读取"), "missing decode error");
});
await test("non-image rejected and oversized GIF not silently flattened", async () => {
  for (const file of [new File(["text"], "text.txt", { type: "text/plain" }), new File([new Uint8Array(MAX_IMAGE_BYTES + 1)], "animated.gif", { type: "image/gif" })]) {
    let rejected = false;
    try { await prepareTaskImage(file); } catch { rejected = true; }
    check(rejected, "unsupported input accepted");
  }
});
canvas.width = canvas.height = 0;
results.push(results.some((line) => line.startsWith("FAIL")) ? "TESTS FAILED" : "ALL TESTS PASSED");
document.querySelector("#results")!.textContent = results.join("\n");
