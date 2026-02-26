export interface AiChatAttachment {
  content: string; // base64 data URL for images/PDFs, raw text for CSVs
  fileName: string;
  mimeType: string; // 'image/png' | 'image/jpeg' | 'application/pdf' | 'text/csv'
  size: number; // bytes
}
