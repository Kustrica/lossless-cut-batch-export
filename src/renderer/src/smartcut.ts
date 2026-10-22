import i18n from 'i18next';

import { getRealVideoStreams, getVideoTimebase } from './util/streams';

import { readFramesAroundTime, findNextKeyframe, findKeyframeAtExactTime } from './ffmpeg';
import type { FFprobeStream } from '../../common/ffprobe';
import { UserFacingError } from '../errors';
import { readFileSize } from './util';


const mapVideoCodec = (codec: string) => ({ av1: 'libsvtav1' }[codec] ?? codec);

export async function needsSmartCut({ path, desiredCutFrom, videoStream }: {
  path: string,
  desiredCutFrom: number,
  videoStream: Pick<FFprobeStream, 'index'>,
}) {
  const readFrames = async (window: number) => readFramesAroundTime({ filePath: path, streamIndex: videoStream.index, aroundTime: desiredCutFrom, window });

  let frames = await readFrames(10);

  // The player shows the last frame that starts at or before the current time, so when the cutpoint is in the middle of a frame,
  // that frame is what the user sees at the cutpoint. Start exactly at that frame, so that it becomes the first frame of the output.
  // (ffmpeg would otherwise start at the first frame *after* the cutpoint.)
  const shownFrameIndex = frames.findLastIndex((frame) => frame.time <= desiredCutFrom + 0.000001);
  const shownFrame = frames[shownFrameIndex];
  const frameAfterShownFrame = frames[shownFrameIndex + 1];
  const exactCutFrom = shownFrame != null && frameAfterShownFrame != null && frameAfterShownFrame.time > desiredCutFrom ? shownFrame.time : desiredCutFrom;

  let keyframes = frames.filter((frame) => frame.keyframe);

  const keyframeAtExactTime = findKeyframeAtExactTime(keyframes, exactCutFrom);
  if (keyframeAtExactTime) {
    console.log('Start cut is already on exact keyframe', keyframeAtExactTime.time);

    return {
      exactCutFrom: keyframeAtExactTime.time,
      losslessCutFrom: keyframeAtExactTime.time,
      segmentNeedsSmartCut: false,
    };
  }

  let nextKeyframe = findNextKeyframe(keyframes, exactCutFrom);

  if (nextKeyframe == null) {
    // try again with a larger window
    frames = await readFrames(60);
    keyframes = frames.filter((frame) => frame.keyframe);
    nextKeyframe = findNextKeyframe(keyframes, exactCutFrom);
  }
  if (nextKeyframe == null) throw new UserFacingError(i18n.t('Cannot find any keyframe after the desired start cut point'));

  console.log('Smart cut from keyframe', { keyframe: nextKeyframe.time, desiredCutFrom, exactCutFrom });

  return {
    exactCutFrom,
    losslessCutFrom: nextKeyframe.time,
    segmentNeedsSmartCut: true,
  };
}

// eslint-disable-next-line import/prefer-default-export
export async function getCodecParams({ path, fileDuration, streams }: {
  path: string,
  fileDuration: number | undefined,
  streams: Pick<FFprobeStream, 'has_b_frames' | 'time_base' | 'codec_type' | 'disposition' | 'index' | 'bit_rate' | 'codec_name'>[],
}) {
  const videoStreams = getRealVideoStreams(streams);
  if (videoStreams.length > 1) throw new Error('Can only smart cut video with exactly one video stream');

  const [videoStream] = videoStreams;

  if (videoStream == null) throw new Error('Smart cut only works on videos');

  let videoBitrate = parseInt(videoStream.bit_rate!, 10);
  if (Number.isNaN(videoBitrate)) {
    console.warn('Unable to detect input bitrate.');
    const size = await readFileSize(path);
    if (fileDuration == null) throw new Error('Video duration is unknown, cannot estimate bitrate');
    videoBitrate = (size * 8) / fileDuration;
    console.warn('Estimated bitrate.', videoBitrate / 1e6, 'Mbit/s');
  }

  // to account for inaccuracies and quality loss
  // see discussion https://github.com/mifi/lossless-cut/issues/126#issuecomment-1602266688
  videoBitrate = Math.floor(videoBitrate * 1.2);

  const { codec_name: detectedVideoCodec } = videoStream;
  if (detectedVideoCodec == null) throw new Error('Unable to determine codec for smart cut');

  const videoCodec = mapVideoCodec(detectedVideoCodec);
  console.log({ detectedVideoCodec, videoCodec });

  const timebase = getVideoTimebase(videoStream);
  if (timebase == null) console.warn('Unable to determine timebase', videoStream.time_base);

  // seems like ffmpeg handles this itself well when encoding same source file
  // const videoLevel = parseLevel(videoStream);
  // const videoProfile = parseProfile(videoStream);

  return {
    videoStream,
    videoCodec,
    videoBitrate: Math.floor(videoBitrate),
    videoTimebase: timebase,
  };
}
