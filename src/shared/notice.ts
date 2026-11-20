/** A message from main; each occurrence has its own id, so dismissing one doesn't hide the next. */
export type Notice = { id: number; message: string }
