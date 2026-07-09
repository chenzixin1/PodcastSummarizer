/**
 * @jest-environment node
 */

import { createPodcastFromSrt, PodcastUploadError } from '../../lib/podcastUploadPipeline';
import { savePodcastWithCreditDeduction } from '../../lib/db';
import { deleteObject, uploadObject } from '../../lib/objectStorage';
import { enqueueProcessingJob } from '../../lib/processingJobs';

jest.mock('../../lib/db', () => ({
  savePodcastWithCreditDeduction: jest.fn(),
}));

jest.mock('../../lib/objectStorage', () => ({
  deleteObject: jest.fn(),
  uploadObject: jest.fn(),
}));

jest.mock('../../lib/processingJobs', () => ({
  enqueueProcessingJob: jest.fn(),
}));

const mockSavePodcastWithCreditDeduction = savePodcastWithCreditDeduction as jest.Mock;
const mockDeleteObject = deleteObject as jest.Mock;
const mockUploadObject = uploadObject as jest.Mock;
const mockEnqueueProcessingJob = enqueueProcessingJob as jest.Mock;

const baseInput = {
  id: 'podcast-123',
  title: 'Jensen Huang: Why companies need open agent systems',
  originalFileName: 'Yy3JH6dDugc.srt',
  srtContent: Buffer.from('1\n00:00:00,000 --> 00:00:02,000\nhello', 'utf8'),
  sourceReference: 'https://www.youtube.com/watch?v=Yy3JH6dDugc',
  sourcePublishedAt: null,
  tags: ['Jensen'],
  isPublic: true,
  userId: 'user-123',
};

describe('podcastUploadPipeline', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUploadObject.mockResolvedValue({
      key: 'podcast-123-Yy3JH6dDugc.srt',
      provider: 'r2',
      url: 'https://podsum.cc/api/files/podcast-123-Yy3JH6dDugc.srt',
    });
    mockSavePodcastWithCreditDeduction.mockResolvedValue({
      success: true,
      data: { id: 'podcast-123', remainingCredits: 9 },
    });
    mockEnqueueProcessingJob.mockResolvedValue({
      success: true,
      data: { podcastId: 'podcast-123', status: 'queued' },
    });
    mockDeleteObject.mockResolvedValue(undefined);
  });

  it('stores a verified SRT, saves the podcast row, and queues processing', async () => {
    const result = await createPodcastFromSrt(baseInput);

    expect(mockUploadObject).toHaveBeenCalledWith(
      'podcast-123-Yy3JH6dDugc.srt',
      baseInput.srtContent,
      { contentType: 'application/x-subrip' },
    );
    expect(mockSavePodcastWithCreditDeduction).toHaveBeenCalledWith({
      id: 'podcast-123',
      title: 'Jensen Huang: Why companies need open agent systems',
      originalFileName: 'Yy3JH6dDugc.srt',
      fileSize: '0.04 KB',
      blobUrl: 'https://podsum.cc/api/files/podcast-123-Yy3JH6dDugc.srt',
      sourceReference: 'https://www.youtube.com/watch?v=Yy3JH6dDugc',
      sourcePublishedAt: null,
      tags: ['Jensen'],
      isPublic: true,
      userId: 'user-123',
    });
    expect(mockEnqueueProcessingJob).toHaveBeenCalledWith('podcast-123');
    expect(result).toEqual({
      id: 'podcast-123',
      blobUrl: 'https://podsum.cc/api/files/podcast-123-Yy3JH6dDugc.srt',
      objectKey: 'podcast-123-Yy3JH6dDugc.srt',
      originalFileName: 'Yy3JH6dDugc.srt',
      fileSize: '0.04 KB',
      remainingCredits: 9,
      processingQueued: true,
      processingJob: { podcastId: 'podcast-123', status: 'queued' },
      queueError: null,
    });
  });

  it('deletes the uploaded object when saving the podcast row fails', async () => {
    mockSavePodcastWithCreditDeduction.mockResolvedValueOnce({
      success: false,
      errorCode: 'INSUFFICIENT_CREDITS',
      error: 'Insufficient credits.',
    });

    await expect(createPodcastFromSrt(baseInput)).rejects.toMatchObject({
      code: 'INSUFFICIENT_CREDITS',
      status: 402,
      message: '积分不足，无法继续转换 SRT。',
    });
    expect(mockDeleteObject).toHaveBeenCalledWith('https://podsum.cc/api/files/podcast-123-Yy3JH6dDugc.srt');
  });

  it('maps USER_NOT_FOUND save failures to a 404 upload error', async () => {
    mockSavePodcastWithCreditDeduction.mockResolvedValueOnce({
      success: false,
      errorCode: 'USER_NOT_FOUND',
      error: 'User not found.',
    });

    await expect(createPodcastFromSrt(baseInput)).rejects.toMatchObject({
      code: 'USER_NOT_FOUND',
      status: 404,
      message: 'User not found.',
    });
    expect(mockDeleteObject).toHaveBeenCalledWith('https://podsum.cc/api/files/podcast-123-Yy3JH6dDugc.srt');
  });

  it('returns a recoverable queue failure without deleting the saved podcast row', async () => {
    mockEnqueueProcessingJob.mockResolvedValueOnce({
      success: false,
      error: 'D1 insert failed',
    });

    const result = await createPodcastFromSrt(baseInput);

    expect(result.processingQueued).toBe(false);
    expect(result.queueError).toBe('D1 insert failed');
    expect(mockDeleteObject).not.toHaveBeenCalled();
  });

  it('classifies storage failures before any podcast row is saved', async () => {
    mockUploadObject.mockRejectedValueOnce(new Error('Object storage write verification failed for key: podcast-123-Yy3JH6dDugc.srt'));
    const promise = createPodcastFromSrt(baseInput);

    await expect(promise).rejects.toBeInstanceOf(PodcastUploadError);
    await expect(promise).rejects.toMatchObject({
      code: 'UPLOAD_FAILED',
      status: 502,
    });
    expect(mockSavePodcastWithCreditDeduction).not.toHaveBeenCalled();
  });
});
