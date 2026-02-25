const searchInput = document.getElementById('search');
const searchBtn = document.getElementById('searchBtn');
const companySelect = document.getElementById('companySelect');
const docType = document.getElementById('docType');
const loadDocsBtn = document.getElementById('loadDocs');
const documentSelect = document.getElementById('documentSelect');
const focusAreasInput = document.getElementById('focusAreas');
const contentInput = document.getElementById('content');
const fetchContentBtn = document.getElementById('fetchContentBtn');
const contentStatus = document.getElementById('contentStatus');
const analyzeBtn = document.getElementById('analyzeBtn');
const resultEl = document.getElementById('result');

let companies = [];
let documents = [];

function setOptions(selectEl, items, labelFn, valueFn) {
  selectEl.innerHTML = '';
  if (!items.length) {
    const empty = document.createElement('option');
    empty.value = '';
    empty.textContent = 'No data';
    selectEl.appendChild(empty);
    return;
  }

  items.forEach((item) => {
    const option = document.createElement('option');
    option.value = valueFn(item);
    option.textContent = labelFn(item);
    selectEl.appendChild(option);
  });
}

function selectedCompany() {
  return companies.find((c) => c.id === companySelect.value);
}

function selectedDocument() {
  return documents.find((d) => d.id === documentSelect.value);
}

async function searchCompanies() {
  const q = encodeURIComponent(searchInput.value.trim());
  const res = await fetch(`/api/companies?q=${q}`);
  const data = await res.json();
  companies = data.companies || [];
  setOptions(
    companySelect,
    companies,
    (c) => `${c.name}${c.sector ? ` (${c.sector})` : ''}`,
    (c) => c.id
  );
  documents = [];
  setOptions(documentSelect, [], () => '', () => '');
  contentInput.value = '';
  contentStatus.textContent = 'No document content loaded.';
}

async function loadDocuments() {
  const companyId = companySelect.value;
  if (!companyId) {
    alert('Select a company first');
    return;
  }

  const type = encodeURIComponent(docType.value);
  const res = await fetch(`/api/company/${companyId}/documents?type=${type}`);
  const data = await res.json();
  documents = data.documents || [];

  setOptions(
    documentSelect,
    documents,
    (d) => `${d.type.toUpperCase()} | ${d.title} | ${d.date || ''}`,
    (d) => d.id
  );

  contentInput.value = '';
  contentStatus.textContent = 'Select a document and fetch content.';
}

async function fetchDocumentContent() {
  const company = selectedCompany();
  const doc = selectedDocument();

  if (!company || !doc) {
    alert('Pick both company and document');
    return;
  }

  contentStatus.textContent = 'Fetching content from API...';
  const sourceUrlParam = doc.sourceUrl ? `?sourceUrl=${encodeURIComponent(doc.sourceUrl)}` : '';
  const res = await fetch(`/api/company/${company.id}/documents/${doc.id}/content${sourceUrlParam}`);
  const data = await res.json();

  if (!res.ok) {
    contentInput.value = '';
    contentStatus.textContent = `Unable to load content: ${data.error || 'Unknown error'}`;
    return;
  }

  contentInput.value = data.content || '';
  contentStatus.textContent = `Loaded ${contentInput.value.length} characters from API.`;
}

async function analyze() {
  const company = selectedCompany();
  const doc = selectedDocument();

  if (!company || !doc) {
    alert('Pick both company and document');
    return;
  }

  const focusAreas = focusAreasInput.value
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);

  const payload = {
    companyName: company.name,
    documentTitle: doc.title,
    content: contentInput.value.trim(),
    focusAreas
  };

  if (!payload.content) {
    alert('Please fetch document content from API first');
    return;
  }

  resultEl.textContent = 'Analyzing...';

  const res = await fetch('/api/analyze', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const data = await res.json();

  if (!res.ok) {
    resultEl.textContent = `Error: ${data.error || 'Unknown error'}`;
    return;
  }

  resultEl.textContent = JSON.stringify(data.result, null, 2);
}

searchBtn.addEventListener('click', searchCompanies);
loadDocsBtn.addEventListener('click', loadDocuments);
fetchContentBtn.addEventListener('click', fetchDocumentContent);
analyzeBtn.addEventListener('click', analyze);

searchCompanies();
