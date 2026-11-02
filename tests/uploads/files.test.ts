import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { brandFromTheme, detectFile, docxText, imageSize, readPptx, themeColors, themeFonts, UploadError } from "@/lib/uploads/files";

/** A 3×2 PNG header (signature, IHDR) is enough for detection and size. */
function png(w: number, h: number): Buffer {
  const b = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
  b.writeUInt32BE(13, 8);
  b.write("IHDR", 12, "ascii");
  b.writeUInt32BE(w, 16);
  b.writeUInt32BE(h, 20);
  return b;
}

function jpeg(w: number, h: number): Buffer {
  // SOI, an APP0 segment, then SOF0 with height and width.
  return Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x11, 0x08, h >> 8, h & 255, w >> 8, w & 255, 0x03, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
}

const THEME = `<a:theme><a:themeElements><a:clrScheme name="Acme">
<a:dk1><a:sysClr val="windowText" lastClr="111111"/></a:dk1><a:lt1><a:srgbClr val="FAFAFA"/></a:lt1>
<a:dk2><a:srgbClr val="222244"/></a:dk2><a:lt2><a:srgbClr val="EEEEEE"/></a:lt2>
<a:accent1><a:srgbClr val="E4572E"/></a:accent1><a:accent2><a:srgbClr val="29335C"/></a:accent2>
</a:clrScheme><a:fontScheme name="Acme"><a:majorFont><a:latin typeface="Montserrat"/></a:majorFont><a:minorFont><a:latin typeface="Open Sans"/></a:minorFont></a:fontScheme></a:themeElements></a:theme>`;

describe("upload detection", () => {
  it("identifies files by their bytes, not their names", () => {
    expect(detectFile("shot.jpg", png(3, 2))).toMatchObject({ kind: "image", mime: "image/png" });
    expect(detectFile("x.png", jpeg(10, 20))).toMatchObject({ kind: "image", mime: "image/jpeg" });
    expect(detectFile("notes.md", Buffer.from("# Notes\n"))).toMatchObject({ kind: "document", mime: "text/markdown" });
    expect(detectFile("deck.pptx", Buffer.from([0x50, 0x4b, 0x03, 0x04, 0]))).toMatchObject({ kind: "pptx" });
  });

  it("rejects what it cannot read safely", () => {
    expect(() => detectFile("a.pdf", Buffer.from("%PDF-1.7"))).toThrow(UploadError);
    expect(() => detectFile("a.svg", Buffer.from("<svg/>"))).toThrow(UploadError);
    expect(() => detectFile("a.exe", Buffer.from([0x4d, 0x5a]))).toThrow(UploadError);
    expect(() => detectFile("a.zip", Buffer.from([0x50, 0x4b, 0x03, 0x04]))).toThrow(UploadError);
    expect(() => detectFile("a.txt", Buffer.from([0x41, 0x00, 0x42]))).toThrow(UploadError);
  });

  it("reads image sizes from PNG and JPEG headers", () => {
    expect(imageSize(png(1440, 900), "image/png")).toEqual({ width: 1440, height: 900 });
    expect(imageSize(jpeg(640, 480), "image/jpeg")).toEqual({ width: 640, height: 480 });
  });
});

describe("document and template text", () => {
  it("extracts .docx paragraphs as lines", async () => {
    const zip = new JSZip();
    zip.file("word/document.xml", `<w:document><w:body><w:p><w:r><w:t>Results</w:t></w:r></w:p><w:p><w:r><w:t xml:space="preserve">Latency fell </w:t></w:r><w:r><w:t>40% &amp; more</w:t></w:r></w:p></w:body></w:document>`);
    expect(await docxText(await zip.generateAsync({ type: "nodebuffer" }))).toBe("Results\nLatency fell 40% & more");
  });

  it("reads a .pptx theme as a brand and its slide text", async () => {
    const zip = new JSZip();
    zip.file("ppt/theme/theme1.xml", THEME);
    zip.file("ppt/slides/slide1.xml", `<p:sld><a:p><a:r><a:t>Q3 review</a:t></a:r></a:p><a:p><a:r><a:t>Revenue up</a:t></a:r></a:p></p:sld>`);
    const info = await readPptx(await zip.generateAsync({ type: "nodebuffer" }));
    expect(info.slides).toBe(1);
    expect(info.text).toBe("Slide 1:\nQ3 review\nRevenue up");
    expect(info.brand).toEqual({ accent: "#e4572e", accent2: "#29335c", background: "#fafafa", text: "#111111", headingFont: "Montserrat", bodyFont: "Open Sans" });
  });

  it("ignores theme font placeholders", () => {
    expect(themeFonts(`<a:majorFont><a:latin typeface="+mj-lt"/></a:majorFont>`)).toEqual({ heading: undefined, body: undefined });
    expect(brandFromTheme(themeColors(""), {})).toEqual({});
  });
});
