import type { Movie } from "../api";

export default function MovieDetailModal({ movie, onClose }: { movie: Movie; onClose: () => void; onChanged?: () => void }) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>{movie.titel}</h2>
        <button onClick={onClose}>Schließen</button>
      </div>
    </div>
  );
}
