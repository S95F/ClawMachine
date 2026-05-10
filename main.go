package main

import (
	"embed"
	"flag"
	"io/fs"
	"log"
	"net/http"
	"strconv"
	"time"
)

//go:embed web/*
var webFS embed.FS

func main() {
	port := flag.Int("port", 8080, "HTTP listen port")
	addr := flag.String("addr", "", "Bind address (default: all interfaces)")
	flag.Parse()

	sub, err := fs.Sub(webFS, "web")
	if err != nil {
		log.Fatalf("embed: %v", err)
	}

	mux := http.NewServeMux()
	mux.Handle("/", noCache(http.FileServer(http.FS(sub))))
	mux.HandleFunc("/healthz", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/plain; charset=utf-8")
		w.Write([]byte("ok"))
	})

	listen := *addr + ":" + strconv.Itoa(*port)
	srv := &http.Server{
		Addr:              listen,
		Handler:           logRequests(mux),
		ReadHeaderTimeout: 10 * time.Second,
	}

	log.Printf("claw machine listening on %s", listen)
	if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		log.Fatalf("server: %v", err)
	}
}

func logRequests(h http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		h.ServeHTTP(w, r)
		log.Printf("%s %s %s %s", r.RemoteAddr, r.Method, r.URL.Path, time.Since(start))
	})
}

func noCache(h http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-cache, no-store, must-revalidate")
		h.ServeHTTP(w, r)
	})
}
