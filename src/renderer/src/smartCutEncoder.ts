import { runFfmpeg } from './ffmpeg';

// Encoder used for the short re-encoded part at the start of a segment when smart cutting.
// The encoded part is concatenated with the stream-copied rest of the segment, so it must produce the same codec,
// pixel format and timebase as the source. The bitrate is chosen by the caller (based on the source bitrate).

export interface SmartCutEncoder {
  // ffmpeg encoder name, e.g. h264_nvenc, used in logs and shown to the user
  name: string,
  hardware: boolean,
  getArgs: (params: { outputIndex: number, bitrate: number }) => string[],
}

// Pixel formats that the hardware H.264 encoders below can produce (8 bit 4:2:0)
const hardwareH264PixFmts = new Set(['yuv420p', 'yuvj420p', 'nv12']);

const hardwareH264Encoders: SmartCutEncoder[] = [
  {
    name: 'h264_nvenc',
    hardware: true,
    getArgs: ({ outputIndex: i, bitrate }) => [`-c:${i}`, 'h264_nvenc', `-preset:${i}`, 'p5', `-tune:${i}`, 'hq', `-rc:${i}`, 'vbr', `-b:${i}`, String(bitrate), `-maxrate:${i}`, String(bitrate * 2), `-bufsize:${i}`, String(bitrate * 2)],
  },
  {
    name: 'h264_qsv',
    hardware: true,
    getArgs: ({ outputIndex: i, bitrate }) => [`-c:${i}`, 'h264_qsv', `-preset:${i}`, 'medium', `-b:${i}`, String(bitrate), `-maxrate:${i}`, String(bitrate * 2), `-bufsize:${i}`, String(bitrate * 2)],
  },
  {
    name: 'h264_amf',
    hardware: true,
    getArgs: ({ outputIndex: i, bitrate }) => [`-c:${i}`, 'h264_amf', `-quality:${i}`, 'balanced', `-rc:${i}`, 'vbr_peak', `-b:${i}`, String(bitrate), `-maxrate:${i}`, String(bitrate * 2), `-bufsize:${i}`, String(bitrate * 2)],
  },
];

// Note: hardware HEVC encoders are deliberately not used. Their parameter sets (VPS/SPS/PPS) differ from the source's,
// and HEVC files usually only store the parameter sets once (not in-band at every keyframe),
// so the stream-copied part would then be decoded with the wrong parameter sets (corrupt picture).

const softwareEncoders: Record<string, SmartCutEncoder> = {
  h264: {
    name: 'libx264',
    hardware: false,
    getArgs: ({ outputIndex: i, bitrate }) => [`-c:${i}`, 'libx264', `-preset:${i}`, 'veryfast', `-b:${i}`, String(bitrate)],
  },
  hevc: {
    name: 'libx265',
    hardware: false,
    getArgs: ({ outputIndex: i, bitrate }) => [`-c:${i}`, 'libx265', `-preset:${i}`, 'fast', `-b:${i}`, String(bitrate), '-x265-params', 'log-level=error'],
  },
};

// The given encoder (or codec name, so that ffmpeg picks its default encoder for it) with only the bitrate set
export const getPlainEncoder = (codec: string): SmartCutEncoder => ({
  name: codec,
  hardware: false,
  getArgs: ({ outputIndex: i, bitrate }) => [`-c:${i}`, codec, `-b:${i}`, String(bitrate)],
});

const getDefaultEncoder = (codec: string): SmartCutEncoder => softwareEncoders[codec] ?? getPlainEncoder(codec);

// Hardware encoders that failed during this session (e.g. driver problem or unsupported resolution), don't try them again
const failedEncoders = new Set<string>();

const encoderWorksCache = new Map<string, Promise<boolean>>();

async function checkEncoderWorks(encoder: SmartCutEncoder) {
  let promise = encoderWorksCache.get(encoder.name);
  if (promise == null) {
    promise = (async () => {
      try {
        // a tiny test encode, because an encoder can be compiled in, but not usable (no supported GPU/driver)
        await runFfmpeg([
          '-hide_banner', '-loglevel', 'error',
          '-f', 'lavfi', '-i', 'color=c=black:s=640x360:r=30',
          '-frames:v', '5', '-pix_fmt', 'yuv420p',
          ...encoder.getArgs({ outputIndex: 0, bitrate: 1_000_000 }),
          '-f', 'null', '-',
        ], { timeout: 20000 }, { logCli: false });
        console.log('Smart cut encoder works', encoder.name);
        return true;
      } catch (err) {
        console.log('Smart cut encoder not available', encoder.name, err instanceof Error ? err.message.split('\n')[0] : err);
        return false;
      }
    })();
    encoderWorksCache.set(encoder.name, promise);
  }
  return promise;
}

// Returns the encoders to try, in order: a working hardware encoder (if any), then the software encoder as fallback
export async function getSmartCutEncoders({ codec, pixFmt, allowHardware }: { codec: string, pixFmt: string | undefined, allowHardware: boolean }) {
  const softwareEncoder = getDefaultEncoder(codec);
  if (!allowHardware || codec !== 'h264' || pixFmt == null || !hardwareH264PixFmts.has(pixFmt)) return [softwareEncoder];

  for (const encoder of hardwareH264Encoders) {
    // eslint-disable-next-line no-await-in-loop
    if (!failedEncoders.has(encoder.name) && await checkEncoderWorks(encoder)) return [encoder, softwareEncoder];
  }
  return [softwareEncoder];
}

export function markSmartCutEncoderFailed(encoder: SmartCutEncoder) {
  if (encoder.hardware) failedEncoders.add(encoder.name);
}
