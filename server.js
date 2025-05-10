const express = require('express');
const { exec } = require('child_process');
const axios = require('axios');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const path = require('path');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;

app.post('/render', async (req, res) => {
  const { video1, video2, video3, voiceover, captions } = req.body;

  if (!video1 || !video2 || !video3 || !voiceover || !captions) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  const tempDir = path.join(__dirname, 'temp', uuidv4());
  fs.mkdirSync(tempDir, { recursive: true });

  const download = async (url, outputPath) => {
    const response = await axios({ url, responseType: 'stream' });
    const writer = fs.createWriteStream(outputPath);
    response.data.pipe(writer);
    return new Promise((resolve, reject) => {
      writer.on('finish', resolve);
      writer.on('error', reject);
    });
  };

  const inputs = {
    v1: path.join(tempDir, 'v1.mp4'),
    v2: path.join(tempDir, 'v2.mp4'),
    v3: path.join(tempDir, 'v3.mp4'),
    vo: path.join(tempDir, 'voiceover.mp3'),
    srt: path.join(tempDir, 'subtitles.srt'),
    output: path.join(tempDir, 'final.mp4')
  };

  try {
    await Promise.all([
      download(video1, inputs.v1),
      download(video2, inputs.v2),
      download(video3, inputs.v3),
      download(voiceover, inputs.vo)
    ]);

    const srtContent = captions.map((c, i) => {
      const formatTime = (s) => {
        const pad = n => String(Math.floor(n)).padStart(2, '0');
        const ms = String(Math.floor((s % 1) * 1000)).padStart(3, '0');
        const totalSec = Math.floor(s);
        const h = pad(totalSec / 3600);
        const m = pad((totalSec % 3600) / 60);
        const sec = pad(totalSec % 60);
        return `${h}:${m}:${sec},${ms}`;
      };
      return `${i+1}
${formatTime(c.start)} --> ${formatTime(c.start + c.duration)}
${c.text}
`;
    }).join('
');
    fs.writeFileSync(inputs.srt, srtContent);

    const cmd = `ffmpeg -y -i "${inputs.v1}" -i "${inputs.v2}" -i "${inputs.v3}" -i "${inputs.vo}" -filter_complex "[0:v]setpts=1.5*PTS[v0];[1:v]setpts=1.5*PTS[v1];[2:v]setpts=2*PTS[v2];[v0][v1][v2]concat=n=3:v=1:a=0[outv]" -map "[outv]" -map 3:a -vf "subtitles='${inputs.srt}'" "${inputs.output}"`;
    exec(cmd, (err) => {
      if (err) return res.status(500).json({ error: "FFmpeg failed", details: err.message });
      res.sendFile(inputs.output);
    });
  } catch (e) {
    res.status(500).json({ error: "Rendering failed", details: e.message });
  }
});

app.listen(PORT, () => console.log(`FFmpeg API running on port ${PORT}`));