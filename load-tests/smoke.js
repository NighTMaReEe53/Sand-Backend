import http from 'k6/http';
import { check, sleep } from 'k6';

const baseUrl = (__ENV.BASE_URL || 'http://localhost:3000/api/v1').replace(/\/$/, '');

export const options = {
  stages: [
    { duration: '20s', target: 5 },
    { duration: '60s', target: Number(__ENV.VUS || 20) },
    { duration: '20s', target: 0 },
  ],
  thresholds: {
    http_req_failed: ['rate<0.01'],
    http_req_duration: ['p(95)<1000'],
  },
};

export default function () {
  const health = http.get(`${baseUrl}/health`, { tags: { endpoint: 'health' } });
  check(health, {
    'health endpoint responds': (response) => response.status === 200,
    'database is available': (response) => response.json('services.database') === 'connected',
  });

  const courses = http.get(`${baseUrl}/courses?limit=12`, { tags: { endpoint: 'course-list' } });
  check(courses, {
    'course list responds': (response) => response.status === 200,
    'course list is valid JSON': (response) => {
      try {
        return typeof response.json() === 'object';
      } catch {
        return false;
      }
    },
  });

  sleep(Math.random() * 2 + 1);
}
