// Quick test of OpenCode.ai API
const KEY = 'sk-mLTguli7F5n6BjcjanzcfSCi3B9o4o8SN6oFLYZ7tdKJs6C0n3Jrp4EJaDduYHbF';
const URL = 'https://opencode.ai/zen/v1/chat/completions';

const body = {
  model: 'deepseek-v4-flash-free',
  messages: [{ role: 'user', content: 'Reply with OK only.' }],
  temperature: 0.2,
  max_tokens: 50,
};

const res = await fetch(URL, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${KEY}`,
  },
  body: JSON.stringify(body),
});

console.log('Status:', res.status);
const data = await res.json();
console.log('Response:', JSON.stringify(data, null, 2));

if (data.choices?.[0]?.message?.content) {
  console.log('\n✅ OpenCode API works! Content:', data.choices[0].message.content);
} else if (data.choices?.[0]?.message?.reasoning_content) {
  console.log('\n✅ OpenCode API works! (reasoning model, content in reasoning_content)');
  console.log('Reasoning:', data.choices[0].message.reasoning_content);
} else {
  console.log('\n❌ No content in response');
}
