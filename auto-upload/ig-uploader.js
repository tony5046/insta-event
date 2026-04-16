// auto-upload/ig-uploader.js
// 쿠키 기반 인스타그램 업로드 (피드 게시물 + 스토리)
// 기존 server.js의 업로드 로직과 동일한 패턴 사용

const https = require('https');
const fs = require('fs');

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
const IG_APP_ID = '936619743392459';
const IG_CLAIM = 'hmac.AR3W0DThY2Mu5Fag4sW5u3RhaR3qhFD_5it9HpNqa_77bWtX';

function extractCsrf(cookies) {
  const m = cookies.match(/csrftoken=([^;]+)/);
  return m ? m[1] : '';
}

// 이미지를 rupload 엔드포인트로 업로드 (피드/스토리 공통)
function uploadPhoto(imageBuffer, uploadName, uploadId, cookies, csrfToken, isStory = false) {
  return new Promise((resolve, reject) => {
    const photoUploadParams = JSON.stringify({
      media_type: 1,
      upload_id: uploadId,
      upload_media_height: 1080,
      upload_media_width: 1080,
      xsharing_user_ids: '[]',
      image_compression: JSON.stringify({ lib_name: 'moz', lib_version: '3.1.m', quality: '80' }),
    });

    const options = {
      hostname: 'www.instagram.com',
      path: `/rupload_igphoto/${uploadName}`,
      method: 'POST',
      headers: {
        'User-Agent': USER_AGENT,
        'Cookie': cookies,
        'X-CSRFToken': csrfToken,
        'X-IG-App-ID': IG_APP_ID,
        'X-IG-WWW-Claim': IG_CLAIM,
        'X-Instagram-Rupload-Params': photoUploadParams,
        'X-Entity-Type': 'image/jpeg',
        'X-Entity-Name': uploadName,
        'X-Entity-Length': imageBuffer.length,
        'Content-Type': 'image/jpeg',
        'Content-Length': imageBuffer.length,
        'Offset': '0',
        'Sec-Fetch-Site': 'same-origin',
        'Sec-Fetch-Mode': 'cors',
        'Sec-Fetch-Dest': 'empty',
        'Referer': isStory
          ? 'https://www.instagram.com/stories/create/'
          : 'https://www.instagram.com/create/style/',
        'Origin': 'https://www.instagram.com',
      },
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        if (res.statusCode !== 200) {
          return reject(new Error(`이미지 업로드 실패 (${res.statusCode}): ${data.substring(0, 200)}`));
        }
        try { resolve(JSON.parse(data)); }
        catch { reject(new Error('이미지 업로드 응답 파싱 실패')); }
      });
    });

    req.on('error', reject);
    req.write(imageBuffer);
    req.end();
  });
}

// 피드 게시물 발행 (캡션 optional)
function configureFeedPost(uploadId, caption, cookies, csrfToken) {
  return new Promise((resolve, reject) => {
    const configData = JSON.stringify({
      source_type: 'library',
      caption: caption || '',
      upload_id: uploadId,
      disable_comments: '0',
      like_and_view_counts_disabled: false,
      igtv_share_preview_to_feed: false,
      is_unified_video: false,
      video_subtitles_enabled: false,
    });

    const bodyData = `signed_body=SIGNATURE.${encodeURIComponent(configData)}`;

    const options = {
      hostname: 'www.instagram.com',
      path: '/api/v1/media/configure/',
      method: 'POST',
      headers: {
        'User-Agent': USER_AGENT,
        'Cookie': cookies,
        'X-CSRFToken': csrfToken,
        'X-IG-App-ID': IG_APP_ID,
        'X-IG-WWW-Claim': IG_CLAIM,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(bodyData),
        'Sec-Fetch-Site': 'same-origin',
        'Sec-Fetch-Mode': 'cors',
        'Sec-Fetch-Dest': 'empty',
        'Referer': 'https://www.instagram.com/create/details/',
        'Origin': 'https://www.instagram.com',
      },
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        if (res.statusCode !== 200) {
          return reject(new Error(`피드 발행 실패 (${res.statusCode}): ${data.substring(0, 200)}`));
        }
        try {
          const parsed = JSON.parse(data);
          if (parsed.status !== 'ok') {
            return reject(new Error(`피드 발행 실패: ${parsed.message || data.substring(0, 200)}`));
          }
          resolve(parsed);
        } catch {
          reject(new Error('피드 발행 응답 파싱 실패'));
        }
      });
    });

    req.on('error', reject);
    req.write(bodyData);
    req.end();
  });
}

// 스토리 발행 (configure_to_story)
function configureStory(uploadId, cookies, csrfToken) {
  return new Promise((resolve, reject) => {
    const clientTimestamp = Math.floor(Date.now() / 1000);
    const configData = JSON.stringify({
      source_type: '3',
      configure_mode: '1',
      upload_id: uploadId,
      client_shared_at: String(clientTimestamp - 5),
      client_timestamp: String(clientTimestamp),
      capture_type: 'normal',
      camera_entry_point: '34',
      timezone_offset: String(9 * 3600), // 한국 UTC+9
      disable_comments: '0',
    });

    const bodyData = `signed_body=SIGNATURE.${encodeURIComponent(configData)}`;

    const options = {
      hostname: 'www.instagram.com',
      path: '/api/v1/media/configure_to_story/',
      method: 'POST',
      headers: {
        'User-Agent': USER_AGENT,
        'Cookie': cookies,
        'X-CSRFToken': csrfToken,
        'X-IG-App-ID': IG_APP_ID,
        'X-IG-WWW-Claim': IG_CLAIM,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(bodyData),
        'Sec-Fetch-Site': 'same-origin',
        'Sec-Fetch-Mode': 'cors',
        'Sec-Fetch-Dest': 'empty',
        'Referer': 'https://www.instagram.com/stories/create/',
        'Origin': 'https://www.instagram.com',
      },
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        if (res.statusCode !== 200) {
          return reject(new Error(`스토리 발행 실패 (${res.statusCode}): ${data.substring(0, 200)}`));
        }
        try {
          const parsed = JSON.parse(data);
          if (parsed.status !== 'ok') {
            return reject(new Error(`스토리 발행 실패: ${parsed.message || data.substring(0, 200)}`));
          }
          resolve(parsed);
        } catch {
          reject(new Error('스토리 발행 응답 파싱 실패'));
        }
      });
    });

    req.on('error', reject);
    req.write(bodyData);
    req.end();
  });
}

// ===== 최상위 헬퍼 =====
async function uploadFeed({ imagePath, cookies, caption = '' }) {
  const imageBuffer = fs.readFileSync(imagePath);
  const csrfToken = extractCsrf(cookies);
  if (!csrfToken) throw new Error('쿠키에서 csrftoken을 찾을 수 없습니다.');

  const uploadId = Date.now().toString();
  const uploadName = `${uploadId}_0_${Math.floor(Math.random() * 9000000000 + 1000000000)}`;

  await uploadPhoto(imageBuffer, uploadName, uploadId, cookies, csrfToken, false);
  const result = await configureFeedPost(uploadId, caption, cookies, csrfToken);

  const code = result.media?.code || '';
  return {
    type: 'feed',
    mediaId: result.media?.id || '',
    code,
    url: code ? `https://www.instagram.com/p/${code}/` : '',
  };
}

async function uploadStory({ imagePath, cookies }) {
  const imageBuffer = fs.readFileSync(imagePath);
  const csrfToken = extractCsrf(cookies);
  if (!csrfToken) throw new Error('쿠키에서 csrftoken을 찾을 수 없습니다.');

  const uploadId = Date.now().toString();
  const uploadName = `${uploadId}_0_${Math.floor(Math.random() * 9000000000 + 1000000000)}`;

  await uploadPhoto(imageBuffer, uploadName, uploadId, cookies, csrfToken, true);
  const result = await configureStory(uploadId, cookies, csrfToken);

  return {
    type: 'story',
    mediaId: result.media?.id || '',
    code: result.media?.code || '',
  };
}

module.exports = { uploadFeed, uploadStory };
