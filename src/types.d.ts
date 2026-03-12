// Express Request augmentation — adds profile context set by profile middleware

declare namespace Express {
  interface Request {
    profile: { id: number; name: string };
  }
}
