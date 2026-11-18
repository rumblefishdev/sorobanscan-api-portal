## **x402 Facilitator API keys**

This section applies if you obtain an API key for the **x402 Facilitator** through the portal. It adds to the sections above and does not replace them.

When an x402 API key is issued, We keep a record of it in Our API key registry. The record holds your Discord account ID, the SHA-256 hash of the key, the state of the key (active or revoked), and the dates on which it was issued and revoked. The registry does not hold the key itself.

So that the portal can show your key again, We also keep a copy of the key, stored in encrypted form. The copy is deleted when the key is revoked.

The x402 Facilitator's servers log events concerning API keys, such as the issuing and the revocation of a key, without your Discord account ID. The portal's servers, where you sign in and manage your key, log these events with it, as section 2 describes for the portal's logs.

When an x402 API key is revoked, the registry record remains as the record of that revocation. A request for revocation or deletion is made as described in section 10 (API Key Revocation and Deletion Requests).
