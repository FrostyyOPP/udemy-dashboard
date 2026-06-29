// Quick credential check. Run with: npm run test:auth
import { udemyGet } from './udemyClient.js';

try {
  const data = await udemyGet('/taught-courses/courses/', { page: 1, page_size: 1 });
  console.log('✅ Auth works. Total taught courses:', data?.count ?? '?');
  if (data?.results?.[0]) console.log('   First course:', data.results[0].title);
} catch (err) {
  console.error('❌ Auth failed:', err.message);
  if (err.status) console.error('   HTTP status:', err.status);
  if (err.body) console.error('   Response:', JSON.stringify(err.body).slice(0, 500));
  process.exit(1);
}
