function AlbumCard({ album, onSelect }) {
  return (
    <button
      type="button"
      className="group relative cursor-pointer flex-shrink-0 w-[272px] bg-white text-left"
      onClick={() => onSelect?.(album)}
    >
      <div className="aspect-[4/3] w-full overflow-hidden rounded-2xl shadow-lg">
        <img
          src={album.cover}
          alt={album.title}
          className="h-full w-full object-cover"
          loading="lazy"
        />
      </div>
      <div className="pt-3 px-1.5">
        <div className="text-base font-medium truncate">{album.title}</div>
        <div className="text-sm text-black/60 mt-0.5">
          {album.photos.length} photos
        </div>
      </div>
    </button>
  );
}

export default AlbumCard;
