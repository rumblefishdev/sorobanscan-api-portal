## **x402 Facilitator API keys**

This section applies if you obtain an API key for the **x402 Facilitator** through the portal. It adds to the sections above and does not replace them.

When an x402 API key is issued, We keep a record of it in Our API key registry. The record holds your Discord account ID, the SHA-256 hash of the key, the state of the key (active or revoked), and the dates on which it was issued and revoked. The registry does not hold the key itself.

So that the portal can show your key again, We also keep a copy of the key, stored in encrypted form. The copy is deleted when the key is revoked, and may remain in Our encrypted database backups for up to 14 days.

When the portal asks the x402 Facilitator about your key, or to issue, show or revoke it, it sends your Discord account ID and your Discord username. The x402 Facilitator uses the ID to find your key and does not store or log the username.

When you use the key on Stellar Mainnet (`stellar:pubnet`), the x402 Facilitator checks it against the registry, counts your requests against its rate limits under your Discord account ID, and logs each request it verifies or settles with your Discord account ID.

The portal's servers log your sign-ins and the issuing, showing and revocation of your key with your Discord account ID. The servers that manage x402 keys log the same events with a short identifier of the key, without your Discord account ID.

The registry, the encrypted copies and the x402 Facilitator run on a dedicated server rented from **Hetzner** in Germany, which requests reach through **Cloudflare**. Their logs are sent to Amazon CloudWatch in the AWS `eu-central-1` region and kept for up to 30 days. Their database backups are encrypted and kept on Hetzner storage for 14 days.

When an x402 API key is revoked, the registry record remains as the record of that revocation, and is used to decide when you can get a new key (from the next calendar month). A request for revocation or deletion is made as described in section 10 (API Key Revocation and Deletion Requests).
