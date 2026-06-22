const express = require('express');
const path = require('path');

const app = express();
const PORT = 3514;

app.use(express.static(path.join(__dirname)));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/cleaner-mobile', (req, res) => {
  res.sendFile(path.join(__dirname, 'cleaner-mobile.html'));
});

app.listen(PORT, () => {
  console.log(`前端服务器运行在 http://localhost:${PORT}`);
});
