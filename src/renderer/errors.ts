export class DirectoryAccessDeclinedError extends Error {
  constructor() {
    super();
    this.name = 'DirectoryAccessDeclinedError';
  }
}

export class UnsupportedFileError extends Error {
  // e.g. last line of ffprobe's stderr
  reason: string | undefined;

  constructor(message: string, opts?: ErrorOptions & { reason?: string | undefined }) {
    super(message, opts);
    this.name = 'UnsupportedFileError';
    this.reason = opts?.reason;
  }
}

// File has damaged metadata that we know how to repair (see util/mp4Repair.ts)
export class DamagedMetadataError extends UnsupportedFileError {
  constructor(message: string, opts?: ErrorOptions & { reason?: string | undefined }) {
    super(message, opts);
    this.name = 'DamagedMetadataError';
  }
}

export class UserFacingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UserFacingError';
  }
}
