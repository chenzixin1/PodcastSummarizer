import fetch from 'node-fetch'; // Or use global.fetch if on Node 18+
import assert from 'assert';

async function testProcessStream() {
  const apiUrl = 'http://localhost:3000/api/process'; // Adjust port if necessary
  const testFileId = `test-srt-${Date.now()}`;
  const testFileName = 'test.srt';
  // This URL should be accessible by your Next.js dev server
  const testBlobUrl = 'http://localhost:3000/test.srt'; 

  console.log(`🧪 Starting test for streaming API: ${apiUrl}`);
  console.log(`   File ID: ${testFileId}`);
  console.log(`   Blob URL: ${testBlobUrl}`);

  let eventCount = 0;
  let summaryTokenCount = 0;
  let summaryFinalResult = null;
  let statusMessages = [];
  let errorMessages = [];
  let allDoneEvent = null;

  try {
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        id: testFileId,
        blobUrl: testBlobUrl,
        fileName: testFileName,
      }),
    });

    assert.strictEqual(response.ok, true, `API request failed with status: ${response.status}`);
    assert.ok(response.headers.get('content-type')?.startsWith('text/event-stream'), 'Unexpected content type.');
    
    console.log('✅ API request successful, content type is text/event-stream.');
    console.log('📡 Receiving stream...');

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        console.log('🏁 Stream finished.');
        assert.strictEqual(buffer.trim().length, 0, ` 남아 있는 버퍼 데이터가 있습니다.: ${buffer}`);
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      
      let eolIndex;
      while ((eolIndex = buffer.indexOf('\n\n')) >= 0) {
        const message = buffer.substring(0, eolIndex);
        buffer = buffer.substring(eolIndex + 2);
        eventCount++;

        if (message.startsWith('data: ')) {
          const jsonData = message.substring(5).trim();
          const eventData = JSON.parse(jsonData);
          console.log(`[Event ${eventCount}] Received SSE Event:`, JSON.stringify(eventData));

          switch (eventData.type) {
            case 'status':
              statusMessages.push(eventData.message);
              assert.ok(eventData.message, 'Status event should have a message.');
              break;
            case 'summary_token':
              summaryTokenCount++;
              assert.ok(typeof eventData.content === 'string', 'summary_token event should have string content.');
              break;
            case 'summary_final_result':
              summaryFinalResult = eventData.content;
              assert.ok(typeof eventData.content === 'string', 'summary_final_result should have string content.');
              assert.ok(eventData.isFinalChunk, 'summary_final_result should be marked as final chunk.');
              break;
            case 'error':
              errorMessages.push(eventData.message);
              assert.ok(eventData.message, 'Error event should have a message.');
              break;
            case 'all_done':
              allDoneEvent = eventData;
              assert.ok(eventData.finalResults, 'all_done event should have finalResults.');
              assert.ok(typeof eventData.finalResults.summary === 'string', 'all_done event should have a summary string.');
              // For now, translation and highlights are placeholders
              assert.strictEqual(eventData.finalResults.translation, 'Translation not processed in this version.');
              assert.strictEqual(eventData.finalResults.highlights, 'Highlights not processed in this version.');
              break;
            default:
              // Allow other event types, but log them if unexpected
              console.warn(`Received unhandled event type: ${eventData.type}`);
          }
        } else if (message.trim().length > 0) {
            console.warn('Received non-SSE message line:', message);
        }
      }
    }

    // Final Assertions after stream is complete
    console.log('\n🔬 Final Assertions:');
    assert.ok(eventCount > 0, 'Expected at least one event.');
    assert.ok(statusMessages.length > 0, 'Expected at least one status message.');
    console.log(`  Total status messages: ${statusMessages.length}`);
    
    // If no errors occurred during summary generation specifically
    if (!errorMessages.some(err => err.toLowerCase().includes('summary'))) {
        assert.ok(summaryTokenCount > 0, 'Expected summary tokens if summary succeeded.');
        console.log(`  Total summary tokens: ${summaryTokenCount}`);
        assert.ok(summaryFinalResult, 'Expected a final summary result if summary succeeded.');
        assert.ok(summaryFinalResult.length > 0, 'Expected final summary result to not be empty if summary succeeded.');
        console.log(`  Final summary length: ${summaryFinalResult.length}`);
    }

    assert.ok(allDoneEvent, 'Expected an all_done event.');
    if (allDoneEvent && allDoneEvent.finalResults) {
        assert.strictEqual(allDoneEvent.finalResults.summary, summaryFinalResult, 'Summary in all_done should match final summary result event.');
    }
    
    if (errorMessages.length > 0) {
      console.warn(`   ⚠️ Test completed with ${errorMessages.length} error events:`, errorMessages);
    } else {
      console.log('✅ All assertions passed. Stream processing seems OK.');
    }

  } catch (error) {
    console.error('❌ Test script error:', error);
    assert.fail(error);
  }
}

testProcessStream(); 