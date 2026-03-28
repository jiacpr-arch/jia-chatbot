module.exports = (req, res) => {
  res.status(200).json({
    status: 'ok',
    service: 'JIA Chatbot',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
  });
};
