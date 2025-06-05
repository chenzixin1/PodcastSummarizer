# Podcast Summarizer TODO

## Issues

### UI/UX Issues

- **[HIGH] Fix Content Flickering in Streaming Display**
  - **Issue:** The content in the dashboard page flickers when streaming responses from OpenRouter
  - **Location:** `app/dashboard/[id]/page.tsx`
  - **Affected components:** 
    - Stream processing logic (lines ~117-214)
    - State update in `case 'summary_token'` (lines ~155-179)
    - Content rendering with ReactMarkdown (lines ~245-253)
    - Auto-scrolling implementation (lines ~30-64)
  - **Possible solutions:**
    - Implement a more efficient state update mechanism that doesn't trigger full re-renders
    - Use a dedicated state for stream content that doesn't affect the entire component
    - Consider using a virtualized list for large content renders
    - Review the scrolling behavior implementation to make it smoother
    - Check if ReactMarkdown re-renders can be optimized or memoized

## Future Improvements

- Improve error handling for better user feedback
- Add ability to download summaries as PDF or markdown
- Implement a better history view with search and filter capabilities
- Add user authentication for private transcripts 
