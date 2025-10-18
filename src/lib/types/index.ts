export type StatusType = 'info' | 'success' | 'error';

export interface OcrState {
  stream: MediaStream | null;
  capturedImage: string | null;
  extractedText: string;
  statusMessage: string;
  statusType: StatusType;
  showVideo: boolean;
  showPreview: boolean;
  showCaptureBtn: boolean;
  showProcessBtn: boolean;
  showSpeakBtn: boolean;
  showLoader: boolean;
  showResult: boolean;
  processBtnDisabled: boolean;
}