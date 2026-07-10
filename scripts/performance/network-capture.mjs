function getHeader(headers, name) {
  const match = Object.entries(headers || {}).find(
    ([key]) => key.toLowerCase() === name.toLowerCase(),
  );
  if (!match) return null;
  return Array.isArray(match[1]) ? match[1].join(', ') : String(match[1]);
}

function summarizeResources(resources) {
  const byType = {};
  for (const resource of resources) {
    const type = resource.resourceType.toLowerCase();
    byType[type] ||= { requests: 0, transferBytes: 0 };
    byType[type].requests += 1;
    byType[type].transferBytes += resource.transferBytes;
  }
  return Object.fromEntries(
    Object.entries(byType).sort(([left], [right]) => left.localeCompare(right)),
  );
}

export function createNetworkCaptureState() {
  const resources = [];
  const resourceIndexesByRequestId = new Map();
  const extraStatusesByRequestId = new Map();
  const currentTypeByRequestId = new Map();
  const activeResourceByRequestId = new Map();
  const servedFromCache = new Set();

  function reconcileExtraInfo(requestId) {
    const indexes = resourceIndexesByRequestId.get(requestId) || [];
    const expectedIndexes = indexes.filter((index) => resources[index].expectsExtraInfo);
    const statuses = extraStatusesByRequestId.get(requestId) || [];
    for (let index = 0; index < Math.min(expectedIndexes.length, statuses.length); index += 1) {
      resources[expectedIndexes[index]].status = statuses[index];
      resources[expectedIndexes[index]].extraInfoReceived = true;
    }
  }

  function addResponse({ requestId, response, resourceType, redirectHop, expectsExtraInfo }) {
    const record = {
      requestId,
      url: response.url,
      resourceType: resourceType || 'Other',
      reportedStatus: response.status,
      status: response.status,
      redirectHop,
      protocol: response.protocol,
      transferBytes: response.encodedDataLength || 0,
      fromDiskCache: Boolean(response.fromDiskCache) || servedFromCache.has(requestId),
      fromServiceWorker: Boolean(response.fromServiceWorker),
      cacheHeaders: {
        cacheControl: getHeader(response.headers, 'cache-control'),
        age: getHeader(response.headers, 'age'),
        etag: getHeader(response.headers, 'etag'),
        lastModified: getHeader(response.headers, 'last-modified'),
        cfCacheStatus: getHeader(response.headers, 'cf-cache-status'),
      },
      expectsExtraInfo,
      extraInfoReceived: !expectsExtraInfo,
    };
    const resourceIndex = resources.push(record) - 1;
    const indexes = resourceIndexesByRequestId.get(requestId) || [];
    indexes.push(resourceIndex);
    resourceIndexesByRequestId.set(requestId, indexes);
    activeResourceByRequestId.set(requestId, resourceIndex);
    servedFromCache.delete(requestId);
    reconcileExtraInfo(requestId);
  }

  return {
    onRequestServedFromCache({ requestId }) {
      servedFromCache.add(requestId);
    },
    onRequestWillBeSent(event) {
      const previousType = currentTypeByRequestId.get(event.requestId) || event.type || 'Other';
      if (event.redirectResponse) {
        addResponse({
          requestId: event.requestId,
          response: event.redirectResponse,
          resourceType: previousType,
          redirectHop: true,
          expectsExtraInfo: Boolean(event.redirectHasExtraInfo),
        });
      }
      currentTypeByRequestId.set(event.requestId, event.type || previousType);
    },
    onResponseReceived(event) {
      addResponse({
        requestId: event.requestId,
        response: event.response,
        resourceType: event.type || currentTypeByRequestId.get(event.requestId) || 'Other',
        redirectHop: false,
        expectsExtraInfo: Boolean(event.hasExtraInfo),
      });
    },
    onResponseReceivedExtraInfo({ requestId, statusCode }) {
      const statuses = extraStatusesByRequestId.get(requestId) || [];
      statuses.push(statusCode);
      extraStatusesByRequestId.set(requestId, statuses);
      reconcileExtraInfo(requestId);
    },
    onLoadingFinished({ requestId, encodedDataLength }) {
      const resourceIndex = activeResourceByRequestId.get(requestId);
      if (resourceIndex !== undefined) {
        resources[resourceIndex].transferBytes = encodedDataLength;
      }
    },
    snapshot() {
      for (const [requestId, indexes] of resourceIndexesByRequestId) {
        const expectedExtraInfo = indexes.filter(
          (index) => resources[index].expectsExtraInfo,
        ).length;
        const receivedExtraInfo = (extraStatusesByRequestId.get(requestId) || []).length;
        if (expectedExtraInfo !== receivedExtraInfo) {
          throw new Error(
            `Network response ${requestId} expected ${expectedExtraInfo} extra-info events but received ${receivedExtraInfo}`,
          );
        }
      }
      const publicResources = resources.map((resource) => {
        const record = { ...resource };
        delete record.expectsExtraInfo;
        delete record.extraInfoReceived;
        return record;
      });
      const cacheHeaders = publicResources.map((resource) => ({
        url: resource.url,
        resourceType: resource.resourceType,
        reportedStatus: resource.reportedStatus,
        status: resource.status,
        redirectHop: resource.redirectHop,
        fromDiskCache: resource.fromDiskCache,
        fromServiceWorker: resource.fromServiceWorker,
        ...resource.cacheHeaders,
      }));
      return {
        resources: publicResources,
        cacheHeaders,
        transferBytes: publicResources.reduce(
          (total, resource) => total + resource.transferBytes,
          0,
        ),
        byType: summarizeResources(publicResources),
      };
    },
  };
}
