/**
 * Tests for Analysis API endpoint
 * Tests the /api/analysis/[id] route for retrieving podcast and analysis data
 */

import { GET } from '../../app/api/analysis/[id]/route';
import { NextRequest } from 'next/server';

// Mock the database functions
jest.mock('../../lib/db', () => ({
  getPodcast: jest.fn(),
  getAnalysisResults: jest.fn(),
}));

const { getPodcast, getAnalysisResults } = require('../../lib/db');

describe('/api/analysis/[id] API Route', () => {
  const mockId = 'test-podcast-123';
  
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('GET Method', () => {
    it('should return podcast and analysis data when both exist', async () => {
      // Mock successful responses
      getPodcast.mockResolvedValue({
        success: true,
        data: {
          id: mockId,
          originalFileName: 'test.srt',
          fileSize: '1.2 KB',
          blobUrl: 'blob:test-url'
        }
      });

      getAnalysisResults.mockResolvedValue({
        success: true,
        data: {
          podcastId: mockId,
          summary: 'Test summary',
          translation: 'Test translation',
          highlights: 'Test highlights',
          processedAt: '2024-01-01T00:00:00Z'
        }
      });

      const mockRequest = new NextRequest('http://localhost/api/analysis/test-podcast-123');
      const context = { params: { id: mockId } };

      const response = await GET(mockRequest, context);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.data.isProcessed).toBe(true);
      expect(data.data.podcast.id).toBe(mockId);
      expect(data.data.analysis.summary).toBe('Test summary');
    });

    it('should return podcast data without analysis when analysis does not exist', async () => {
      // Mock podcast exists but analysis doesn't
      getPodcast.mockResolvedValue({
        success: true,
        data: {
          id: mockId,
          originalFileName: 'test.srt',
          fileSize: '1.2 KB',
          blobUrl: 'blob:test-url'
        }
      });

      getAnalysisResults.mockResolvedValue({
        success: false,
        error: 'Analysis results not found'
      });

      const mockRequest = new NextRequest('http://localhost/api/analysis/test-podcast-123');
      const context = { params: { id: mockId } };

      const response = await GET(mockRequest, context);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.data.isProcessed).toBe(false);
      expect(data.data.podcast.id).toBe(mockId);
      expect(data.data.analysis).toBe(null);
    });

    it('should return 404 when podcast does not exist', async () => {
      // Mock podcast not found
      getPodcast.mockResolvedValue({
        success: false,
        error: 'Podcast not found'
      });

      const mockRequest = new NextRequest('http://localhost/api/analysis/test-podcast-123');
      const context = { params: { id: mockId } };

      const response = await GET(mockRequest, context);
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.error).toBe('Podcast not found');
    });

    it('should return 400 when ID is missing', async () => {
      const mockRequest = new NextRequest('http://localhost/api/analysis/');
      const context = { params: { id: '' } };

      const response = await GET(mockRequest, context);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe('Missing ID parameter');
    });

    it('should handle database errors gracefully', async () => {
      // Mock database error
      getPodcast.mockRejectedValue(new Error('Database connection failed'));

      const mockRequest = new NextRequest('http://localhost/api/analysis/test-podcast-123');
      const context = { params: { id: mockId } };

      const response = await GET(mockRequest, context);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.success).toBe(false);
      expect(data.error).toBe('Database connection failed');
    });
  });
}); 