const extractButton = document.getElementById("extract");
const copyButton = document.getElementById("copy");
const xpathInput = document.getElementById("xpath");
const statusNode = document.getElementById("status");
const resultsNode = document.getElementById("results");

let latestResults = [];

function setStatus(message, isError = false) {
  statusNode.textContent = message;
  statusNode.className = isError ? "status error" : "status";
}

function renderResults(urls) {
  latestResults = urls;
  copyButton.disabled = urls.length === 0;

  if (!urls.length) {
    resultsNode.className = "results muted";
    resultsNode.textContent = "没有匹配到任何图片地址。";
    return;
  }

  resultsNode.className = "results";
  resultsNode.innerHTML = "";

  urls.forEach((url, index) => {
    const link = document.createElement("a");
    link.className = "result-item";
    link.href = url;
    link.target = "_blank";
    link.rel = "noreferrer";
    link.textContent = `${index + 1}. ${url}`;
    resultsNode.appendChild(link);
  });
}

async function getActiveTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs[0];
}

async function runExtraction() {
  const xpath = xpathInput.value.trim();
  if (!xpath) {
    setStatus("请先输入 XPath。", true);
    renderResults([]);
    return;
  }

  const activeTab = await getActiveTab();
  if (!activeTab?.id) {
    setStatus("没有拿到当前标签页。", true);
    renderResults([]);
    return;
  }

  extractButton.disabled = true;
  setStatus("正在提取...");

  try {
    const [injectionResult] = await chrome.scripting.executeScript({
      target: { tabId: activeTab.id },
      func: (inputXPath) => {
        const result = document.evaluate(
          inputXPath,
          document,
          null,
          XPathResult.ORDERED_NODE_SNAPSHOT_TYPE,
          null
        );

        const urls = [];

        for (let i = 0; i < result.snapshotLength; i += 1) {
          const node = result.snapshotItem(i);

          if (!node) {
            continue;
          }

          if (node.nodeType === Node.ATTRIBUTE_NODE) {
            urls.push(node.value);
            continue;
          }

          if (node instanceof HTMLImageElement) {
            urls.push(node.currentSrc || node.src);
            continue;
          }

          if (typeof node.getAttribute === "function") {
            const src = node.getAttribute("src");
            if (src) {
              urls.push(src);
            }
          }
        }

        return [...new Set(urls)].filter(Boolean);
      },
      args: [xpath]
    });

    const urls = injectionResult?.result || [];
    setStatus(`提取完成，共 ${urls.length} 条。`);
    renderResults(urls);
  } catch (error) {
    setStatus(`提取失败: ${error.message}`, true);
    renderResults([]);
  } finally {
    extractButton.disabled = false;
  }
}

extractButton.addEventListener("click", runExtraction);

copyButton.addEventListener("click", async () => {
  if (!latestResults.length) {
    return;
  }

  try {
    await navigator.clipboard.writeText(latestResults.join("\n"));
    setStatus(`已复制 ${latestResults.length} 条结果。`);
  } catch (error) {
    setStatus(`复制失败: ${error.message}`, true);
  }
});
