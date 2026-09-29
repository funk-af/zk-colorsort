<template>
  <LegalLayout title="Privacy Policy" effective-date="2026-09-29">
    <h2>The short version</h2>
    <p>
      We keep no accounts, no database, and no analytics. The game runs in your
      browser. The only data that leaves your device is what you choose to put
      on the Algorand blockchain, plus the minimum needed to check who is
      submitting from Discord.
    </p>

    <h2>On your device</h2>
    <p>
      Your best scores, the moves that got them, your display settings, and a
      cache of daily puzzles are stored in your browser's local storage. Clear
      your browser's site data to remove them.
    </p>

    <h2>On the blockchain</h2>
    <p>
      Recording a score writes to the public Algorand ledger, which anyone can
      read and nobody can rewrite.
    </p>
    <ul>
      <li>
        A wallet submission publishes your wallet address, the puzzle, your
        score, and a zero-knowledge proof.
      </li>
      <li>
        A free submission from Discord publishes a one-way hash of your Discord
        user ID instead of an address. The entry is deleted after the day ends,
        though the transactions remain in the ledger's history.
      </li>
      <li>Your move sequence is never published.</li>
    </ul>

    <h2>Discord</h2>
    <p>
      When you open the game in Discord, Discord shares your user ID, username,
      and display name with the game. The user ID is used to build the hashed
      identifier for your score and to confirm with Discord that a submission
      comes from you. The username and display name arrive alongside it and are
      not shown or kept. None of this is stored on our side: it lives in the
      page while it is open and is gone when you close the game. The account's
      creation date, which is encoded in the user ID, is checked so that
      brand-new accounts cannot be used to spam free submissions. We do not read
      your messages or servers. The game only posts a message when you press
      Share, and Discord shows you what will be posted first. You can revoke the
      game at any time under Authorized Apps in your Discord settings.
    </p>

    <h2>Who else sees requests</h2>
    <ul>
      <li>Discord, which proxies everything shown inside an Activity.</li>
      <li>
        Netlify, which hosts the site and runs the small functions behind the
        Discord features. It sees your IP address to serve pages and to rate
        limit requests, and keeps ordinary request logs for a while.
      </li>
      <li>
        The Algorand node and indexer providers the game talks to (currently
        Nodely and AlgoNode), which see your IP address when the game loads
        puzzles and scores or sends transactions.
      </li>
      <li>Your wallet app, if you connect one on the website.</li>
    </ul>
    <p>
      There are no ads, no trackers, and nothing is sold or shared beyond this.
    </p>

    <h2>Removing your data</h2>
    <p>
      Clear your browser's site data, remove your wallet score with the "remove
      score" button, and revoke the app in Discord. Data already on the
      blockchain cannot be deleted by us or anyone else.
    </p>

    <h2>Questions or problems</h2>
    <p>
      To ask about your data, request a change or deletion of anything we can
      still change, or report a problem with the game, open an issue at
      <a
        href="https://github.com/funk-af/zk-colorsort/issues"
        target="_blank"
        rel="noopener"
        >github.com/funk-af/zk-colorsort/issues</a
      >. We read every issue and act on it.
    </p>
    <h2>Changes</h2>
    <p>If this policy changes, the date at the top will be updated.</p>
  </LegalLayout>
</template>

<script setup lang="ts">
import LegalLayout from "./LegalLayout.vue";
</script>
