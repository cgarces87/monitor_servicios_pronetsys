// Se importa ANTES que todo lo demas en index.ts.
//
// libuv crea su pool de hilos (DNS via getaddrinfo, fs, crypto) en el primer
// uso y con 4 hilos por defecto. Con varios chequeos a la vez, un par de hosts
// con DNS lento ocupan los 4 hilos y el resto de chequeos agota su timeout en
// la cola: falsas caidas en cadena. Se amplia si no viene definido.
process.env.UV_THREADPOOL_SIZE ??= '16';
