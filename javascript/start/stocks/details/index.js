const setFields = (stock) => {
    const elementTitle = document.getElementById("app-title");
    elementTitle.innerText = `Stock Details ${stock.RIC}`;

    const elementRIC = document.querySelectorAll("[data-ric]")[0];
    elementRIC.innerText = stock.RIC;

    const elementBPOD = document.querySelectorAll("[data-bpod]")[0];
    elementBPOD.innerText = stock.BPOD;

    const elementBloomberg = document.querySelectorAll("[data-bloomberg]")[0];
    elementBloomberg.innerText = stock.Bloomberg;

    const elementDescription = document.querySelectorAll("[data-description]")[0];
    elementDescription.innerText = stock.Description;

    const elementExchange = document.querySelectorAll("[data-exchange]")[0];
    elementExchange.innerText = stock.Exchange;

    const elementVenues = document.querySelectorAll("[data-venues]")[0];
    elementVenues.innerText = stock.Venues;

    updateStockPrices(stock.Bid, stock.Ask);
};

const updateStockPrices = (bid, ask) => {
    const elementBid = document.querySelectorAll("[data-bid]")[0];
    elementBid.innerText = bid;

    const elementAsk = document.querySelectorAll("[data-ask]")[0];
    elementAsk.innerText = ask;
};

// TODO: Chapter 3
// const toggleIOAvailable = () => {
//     const span = document.getElementById("ioConnectSpan");

//     span.classList.remove("bg-danger");
//     span.classList.add("bg-success");
//     span.textContent = "io.Connect is available";
// };

// TODO: Chapter 6.2
// const updateClientStatus = (client, stock) => {
//     const message = client.portfolio.includes(stock.RIC) ?
//         `${stock.RIC} is in ${client.name}'s portfolio.` :
//         `${stock.RIC} isn't in ${client.name}'s portfolio.`;
//     const elementTitle = document.getElementById("clientStatus");

//     elementTitle.innerText = message;
// };

const start = async () => {
    // TODO: Chapter 3

    // TODO: Chapter 4.3

    // TODO: Chapter 8.3

    setFields(stock);

    // TODO: Chapter 5.4

    // TODO: Chapter 6.2

    // TODO: Chapter 9.5
};

start().catch(console.error);