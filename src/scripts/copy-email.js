// "Copy my email" buttons: copies the address and confirms in place, for
// visitors whose browser has no mail app behind mailto links (common with
// web-only Gmail). Screen readers hear the confirmation through the
// [data-copy-status] live region next to the button.
const status = document.querySelector("[data-copy-status]");

document.querySelectorAll("[data-copy-email]").forEach((btn) => {
  const label = btn.textContent;
  let timer;
  btn.addEventListener("click", async () => {
    const email = btn.dataset.copyEmail;
    let message;
    try {
      await navigator.clipboard.writeText(email);
      message = "Copied. Paste it into any email.";
      btn.textContent = "Email copied";
    } catch (e) {
      // clipboard blocked (older browser or insecure context): show it instead
      message = `My email is ${email}`;
      btn.textContent = email;
    }
    if (status) status.textContent = message;
    clearTimeout(timer);
    timer = setTimeout(() => {
      btn.textContent = label;
      if (status) status.textContent = "";
    }, 2400);
  });
});
