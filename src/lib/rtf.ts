// Pure client-side RTF (Rich Text Format) reader & generator for UtiliBox

/** Extract plain text from RTF content string */
export const extractTextFromRtf = (rtf: string): string => {
  let text = rtf;

  // Remove RTF destination groups (font tables, color tables, stylesheet, etc.)
  text = text.replace(/\{\\(?:fonttbl|colortbl|stylesheet|info|pict|object|themedata)[\s\S]*?\}/gi, "");

  // Replace unicode escape sequences \uN?
  text = text.replace(/\\u(-?\d+)\??/g, (_, code) => {
    const num = parseInt(code, 10);
    return String.fromCharCode(num < 0 ? num + 65536 : num);
  });

  // Replace hex escapes \'xx
  text = text.replace(/\\'([0-9a-fA-F]{2})/g, (_, hex) => {
    return String.fromCharCode(parseInt(hex, 16));
  });

  // Replace standard RTF formatting symbols
  text = text.replace(/\\par\b/gi, "\n");
  text = text.replace(/\\line\b/gi, "\n");
  text = text.replace(/\\tab\b/gi, "\t");
  text = text.replace(/\\b\b|\\b0\b|\\i\b|\\i0\b|\\ul\b|\\ulnone\b/gi, "");

  // Remove all other remaining control words \word
  text = text.replace(/\\[a-zA-Z]+-?\d* ?/g, "");

  // Remove unmatched braces { and }
  text = text.replace(/[{}]/g, "");

  // Clean multiple newlines and trim
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line, idx, arr) => line || (idx > 0 && arr[idx - 1]))
    .join("\n")
    .trim();
};

/** Generate a valid standard RTF document from text */
export const createRtfFromText = (text: string, title?: string): string => {
  const lines = text.split(/\r?\n/);
  const rtfBody: string[] = [];

  if (title) {
    rtfBody.push(`\\fs36\\b ${escapeRtf(title)}\\b0\\fs22\\par\\par`);
  }

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      rtfBody.push("\\par");
      continue;
    }

    if (trimmed.startsWith("# ")) {
      rtfBody.push(`\\fs32\\b ${escapeRtf(trimmed.slice(2))}\\b0\\fs22\\par`);
    } else if (trimmed.startsWith("## ")) {
      rtfBody.push(`\\fs28\\b ${escapeRtf(trimmed.slice(3))}\\b0\\fs22\\par`);
    } else if (trimmed.startsWith("### ")) {
      rtfBody.push(`\\fs24\\b ${escapeRtf(trimmed.slice(4))}\\b0\\fs22\\par`);
    } else if (trimmed.startsWith("- ") || trimmed.startsWith("* ")) {
      rtfBody.push(`\\bullet  ${escapeRtf(trimmed.slice(2))}\\par`);
    } else {
      rtfBody.push(`${escapeRtf(line)}\\par`);
    }
  }

  return `{\\rtf1\\ansi\\deff0{\\fonttbl{\\f0\\fnil\\fcharset0 Arial;}}
{\\colortbl ;\\red17\\green24\\blue39;}
\\viewkind4\\uc1\\pard\\cf1\\lang1033\\f0\\fs22
${rtfBody.join("\n")}
}`;
};

const escapeRtf = (str: string): string => {
  return str
    .replace(/\\/g, "\\\\")
    .replace(/{/g, "\\{")
    .replace(/}/g, "\\}")
    .split("")
    .map((c) => {
      const code = c.charCodeAt(0);
      return code > 127 ? `\\u${code}?` : c;
    })
    .join("");
};
