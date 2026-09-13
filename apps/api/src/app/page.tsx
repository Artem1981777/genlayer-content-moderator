import Link from "next/link";

export default function Home() {
  return (
    <main>
      <h1>ContentModerator API</h1>
      <p>Moderation-as-a-Service over the ContentModerator registry v2 (GenLayer Bradbury).</p>
      <ul>
        <li><Link href="/api/items">GET /api/items</Link></li>
        <li>GET /api/items/&#123;id&#125;</li>
        <li><Link href="/api/stats">GET /api/stats</Link></li>
        <li>GET /api/reputation/&#123;addr&#125;</li>
        <li>GET /api/moderate?url=… — lookup</li>
        <li>POST /api/moderate — submit (write mode only)</li>
        <li>GET /api/badge/&#123;id&#125;.svg — embeddable verdict badge</li>
        <li><Link href="/api/openapi">GET /api/openapi</Link></li>
      </ul>
    </main>
  );
}
