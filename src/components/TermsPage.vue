<template>
  <LegalLayout title="Terms of Service" effective-date="2026-09-28">
    <h2>The short version</h2>
    <p>
      Color Sort is a free daily puzzle game. There is nothing to buy, win,
      or lose. Play as much as you like. If you choose to record a score on
      the Algorand blockchain, a few things below are worth knowing.
    </p>

    <h2>Recording scores with a wallet</h2>
    <ul>
      <li>
        We never see or hold your wallet's keys. Every transaction is signed
        by you, in your wallet, and you pay its small network fee and storage
        deposit. The deposit comes back when you remove the score.
      </li>
      <li>
        The blockchain is public and permanent. Your wallet address, the
        puzzle, and your score are visible to anyone. Removing a score deletes
        the current entry, but the transaction history stays on the ledger.
      </li>
      <li>
        Your moves are never published. The proof that goes on-chain only
        shows the puzzle was solved in that many moves.
      </li>
    </ul>

    <h2>Free submissions from Discord</h2>
    <ul>
      <li>
        Inside Discord you can submit today's score without a wallet. We cover
        the network fee.
      </li>
      <li>
        These scores are cleared after the day ends. If you want to keep one,
        use "Keep permanently with a wallet", which opens the website.
      </li>
      <li>
        Because this costs us a little each time, there are limits on how
        many times per day you can submit or improve a score, and the feature
        may be paused or removed at any time.
      </li>
    </ul>

    <h2>Play fair</h2>
    <p>
      Please do not use solvers, bots, or multiple Discord accounts or wallets
      to game the score comparison, and do not try to break the smart contract
      or the hosting. It is a small hobby project; we may block submissions
      from anyone who does.
    </p>

    <h2>No promises</h2>
    <p>
      The game is offered as is, for fun. We may change or stop any part of
      it, including the daily puzzle and the leaderboard, at any time, and we
      cannot guarantee it is always available or that a score will be recorded
      or kept. We are not responsible for the Algorand network, Discord, or
      your wallet software, or for any loss that comes from using them.
    </p>

    <h2>Age</h2>
    <p>
      Discord requires its users to be at least 13, and the same goes for
      playing here through Discord.
    </p>

    <h2>Changes</h2>
    <p>
      If these terms change, the date at the top will be updated.
    </p>
  </LegalLayout>
</template>

<script setup lang="ts">
import LegalLayout from "./LegalLayout.vue";
</script>
