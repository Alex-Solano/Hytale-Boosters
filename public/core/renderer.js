export function renderCards(cards) {
  const container = document.querySelector("#cards");
  container.innerHTML = "";

  cards.forEach(card => {
    const div = document.createElement("div");
    div.textContent = `${card.name} (${card.rarity})`;
    container.appendChild(div);
  });
}
